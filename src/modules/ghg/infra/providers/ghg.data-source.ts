import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { DataSourceInterface } from '@modules/data-sources/domain/data-source.interface.js';
import {
  SourceOutcome,
  type SourceCallContext,
} from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
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
import { GhgOrganizationDirectory } from './ghg-organization-directory.provider.js';
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
const unavailable = () => ({
  status: 'UNAVAILABLE' as const,
  reason: SourceOutcome.FAILURE,
});

/** Portal publico: nome localiza candidatos, CNPJ exato do PDF confirma identidade. */
@Injectable()
export class GhgDataSource implements DataSourceInterface<GhgQuery, GhgAnswer> {
  readonly slug = GHG_SLUG;
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
    try {
      const cnpj = parseCnpj(query.cnpj);
      if (!cnpj) return unavailable();
      const source = await this.config.execute(this.slug);
      if (!source?.isEnabled) return unavailable();
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
      if (!query.names.some((n) => n.trim().length >= 5)) return unavailable();
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
        if (remaining() <= 0) return null;
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
        if (result.outcome !== SourceOutcome.SUCCESS || result.status !== 200)
          return null;
        return { body: result.body };
      };
      directory = await mkdtemp(join(tmpdir(), 'bios-ghg-'));
      for (const org of candidates) {
        const response = await call(
          [...GHG_PUBLIC_API, 'GetReportedInventories'],
          { organizationId: String(org.id) },
        );
        if (!response) return unavailable();
        // Um inventario recente basta para o sinal de transparencia. Nao inferir todo o historico.
        const latest = readInventories(response.body).sort(
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
        if (!report) return unavailable();
        const identity = await this.reader.read(
          join(directory, 'report.pdf'),
          remaining(),
        );
        if (!identity || identity.year !== latest.year) return unavailable();
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
      return unavailable();
    } catch {
      return unavailable();
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }
}
