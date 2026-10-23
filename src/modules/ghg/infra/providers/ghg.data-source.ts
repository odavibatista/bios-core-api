import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { DataSourceInterface } from '@modules/data-sources/domain/data-source.interface.js';
import {
  SourceOutcome,
  type SourceCallContext,
} from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import {
  UnknownReason,
  unknownReasonOf,
} from '@modules/data-sources/domain/unknown-reason.js';
import { logSourceUnknown } from '@modules/data-sources/infra/usecases/request/log-source-unknown.js';
import {
  RequestDataSourceUseCase,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { ResolveSourceRequestConfigUseCase } from '@modules/data-sources/infra/usecases/request/resolve-source-request-config.usecase.js';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import {
  GHG_SLUG,
  GHG_PUBLIC_API,
  GhgInventorySchema,
  candidateOrganizations,
  ghgBaseUrl,
  readInventories,
  type GhgInventory,
} from '../../domain/ghg-inventory.js';
import {
  GhgOrganizationDirectory,
  GhgOrganizationsUnavailableError,
  GhgSourceDisabledError,
} from './ghg-organization-directory.provider.js';
import { GhgReportReader } from './ghg-report-reader.provider.js';

export interface GhgQuery {
  cnpj: string;
  names: readonly string[];
}
export interface GhgAnswer {
  inventories: GhgInventory[];
  collectedAt: Date;
}
const CacheSchema = z.object({
  collectedAt: z.iso.datetime(),
  inventories: z.array(GhgInventorySchema).min(1),
});

/** Portal publico: nome localiza candidatos, CNPJ exato do PDF confirma identidade. */
@Injectable()
export class GhgDataSource implements DataSourceInterface<GhgQuery, GhgAnswer> {
  readonly slug = GHG_SLUG;
  private readonly logger = new Logger(GhgDataSource.name);
  constructor(
    private readonly request: RequestDataSourceUseCase,
    private readonly config: ResolveSourceRequestConfigUseCase,
    private readonly ttl: ResolveSourceCacheTtlUseCase,
    private readonly cache: CacheProvider,
    private readonly reader: GhgReportReader,
    private readonly directory: GhgOrganizationDirectory,
  ) {}

  async fetch(query: GhgQuery, context: SourceCallContext) {
    let directory: string | undefined;
    // Toda saída sem dado registra o motivo classificado (RF08, sem segredo).
    const unavailable = (reason: UnknownReason, error?: unknown) => {
      logSourceUnknown(this.logger, this.slug, reason, error);

      return { status: 'UNAVAILABLE' as const, reason: SourceOutcome.FAILURE };
    };
    try {
      const cnpj = parseCnpj(query.cnpj);
      if (!cnpj) return unavailable(UnknownReason.INVALID_INPUT);
      const source = await this.config.execute(this.slug);
      if (!source) return unavailable(UnknownReason.SOURCE_NOT_CONFIGURED);
      if (!source.isEnabled) return unavailable(UnknownReason.SOURCE_DISABLED);
      const ttl = await this.ttl.execute(this.slug);
      const key = { namespace: CacheNamespace.GHG_INVENTORY, identifier: cnpj };
      const cached = CacheSchema.safeParse(await this.cache.get(key));
      if (cached.success) {
        const collectedAt = new Date(cached.data.collectedAt);
        const age = Date.now() - collectedAt.getTime();
        if (
          age >= 0 &&
          age < ttl * 1000 &&
          cached.data.inventories.every((i) => i.cnpj === cnpj)
        )
          return {
            status: 'FOUND' as const,
            data: { inventories: cached.data.inventories, collectedAt },
          };
      }
      // Sem nome com o que procurar, nem o cadastro é consultado.
      if (!query.names.some((n) => n.trim().length >= 5))
        return unavailable(UnknownReason.INVALID_INPUT);
      // O cadastro de organizações é sincronizado em segundo plano: a coleta de
      // um CNPJ não faz chamada externa para localizar candidatos. Só na
      // primeira vez (ou com o cache limpo) ele é sincronizado aqui, antes de o
      // prazo desta coleta começar a contar.
      const snapshot =
        (await this.directory.read()) ?? (await this.directory.sync(context));
      const candidates = candidateOrganizations(
        snapshot.organizations,
        query.names,
      );
      const collectedAt = new Date();
      const deadline =
        Date.now() + (source.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
      const remaining = () => deadline - Date.now();
      const call = async (
        segments: string[],
        params?: Record<string, string>,
        report = false,
      ) => {
        if (remaining() <= 0) {
          return { failure: UnknownReason.TIMEOUT } as const;
        }
        const result = await this.request.execute({
          slug: this.slug,
          segments,
          query: params,
          cnpj,
          context,
          budgetMs: remaining(),
          resolveBaseUrl: (base) => ghgBaseUrl(base, report),
          ...(report
            ? {
                download: {
                  destination: join(directory!, 'report.pdf'),
                  maxBytes: 5 * 1024 * 1024,
                },
              }
            : {}),
        });
        if (result.outcome !== SourceOutcome.SUCCESS)
          return { failure: unknownReasonOf(result) } as const;
        if (result.status !== 200)
          return { failure: UnknownReason.UNEXPECTED_STATUS } as const;
        return { body: result.body } as const;
      };
      directory = await mkdtemp(join(tmpdir(), 'bios-ghg-'));
      for (const org of candidates) {
        const response = await call(
          [...GHG_PUBLIC_API, 'GetReportedInventories'],
          { organizationId: String(org.id) },
        );
        if (response.failure) return unavailable(response.failure);
        // Um inventario recente basta para o sinal de transparencia. Nao inferir todo o historico.
        let inventoriesOfOrganization: ReturnType<typeof readInventories>;
        try {
          inventoriesOfOrganization = readInventories(response.body);
        } catch {
          return unavailable(UnknownReason.CONTRACT_MISMATCH);
        }
        const latest = inventoriesOfOrganization.sort(
          (a, b) => b.year - a.year,
        )[0];
        if (!latest) continue;
        const report = await call(
          [
            'GenerateReport',
            'GenerateInventoryReport',
            String(org.id),
            String(latest.cycleId),
            'true',
          ],
          undefined,
          true,
        );
        if (report.failure) return unavailable(report.failure);
        const identity = await this.reader.read(
          join(directory, 'report.pdf'),
          remaining(),
        );
        // Relatório ilegível, sem CNPJ/ano ou com ano diferente do inventário.
        if (!identity || identity.year !== latest.year)
          return unavailable(UnknownReason.CONTRACT_MISMATCH);
        if (identity.cnpj !== cnpj) continue;
        const inventories = [
          {
            cnpj,
            organizationId: org.id,
            cycleId: latest.cycleId,
            year: latest.year,
          },
        ];
        await this.cache.set(
          key,
          { collectedAt: collectedAt.toISOString(), inventories },
          ttl,
        );
        return { status: 'FOUND' as const, data: { inventories, collectedAt } };
      }
      return unavailable(UnknownReason.NO_CONFIRMED_MATCH);
    } catch (error) {
      if (error instanceof GhgSourceDisabledError)
        return unavailable(UnknownReason.SOURCE_DISABLED);
      if (error instanceof GhgOrganizationsUnavailableError)
        return unavailable(error.unknownReason);
      return unavailable(UnknownReason.UNEXPECTED_ERROR, error);
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }
}
