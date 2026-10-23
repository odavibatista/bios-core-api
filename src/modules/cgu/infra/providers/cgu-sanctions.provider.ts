import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Environment } from '@shared/config/environment.config.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import type { SourceUnavailableReason } from '@modules/data-sources/domain/data-source.interface.js';
import {
  SourceOutcome,
  type SourceCallContext,
} from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import {
  UnknownReason,
  unknownReasonOf,
} from '@modules/data-sources/domain/unknown-reason.js';
import { logSourceUnknown } from '@modules/data-sources/infra/usecases/request/log-source-unknown.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { ResolveSourceRequestConfigUseCase } from '@modules/data-sources/infra/usecases/request/resolve-source-request-config.usecase.js';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import {
  CGU_RATE_LIMIT_GROUP,
  CguSanctionSchema,
  readCguPage,
  type CguSanction,
  type CguSlug,
} from '../../domain/cgu-sanction.js';

export type CguLookupResult =
  | { status: 'FOUND'; data: CguSanction[]; collectedAt: Date }
  | { status: 'NOT_FOUND'; collectedAt: Date }
  | { status: 'UNAVAILABLE'; reason: SourceUnavailableReason; message: string };

const CacheSchema = z.object({
  collectedAt: z.iso.datetime(),
  sanctions: z.array(CguSanctionSchema),
});
export const CGU_MAX_PAGES = 100;

/** Paginação e cache compartilhados pelos dois cadastros, com falhas isoladas. */
@Injectable()
export class CguSanctionsProvider {
  private readonly logger = new Logger(CguSanctionsProvider.name);
  constructor(
    private readonly request: RequestDataSourceUseCase,
    private readonly sourceConfig: ResolveSourceRequestConfigUseCase,
    private readonly ttl: ResolveSourceCacheTtlUseCase,
    private readonly cache: CacheProvider,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async fetch(
    slug: CguSlug,
    query: string,
    context: SourceCallContext,
  ): Promise<CguLookupResult> {
    try {
      const cnpj = parseCnpj(query);
      if (!cnpj) return this.unavailable(slug, UnknownReason.INVALID_INPUT);
      const credential = this.config.get('CGU_API_KEY', { infer: true });
      if (!credential) {
        return this.unavailable(
          slug,
          UnknownReason.CREDENTIAL_MISSING,
          SourceOutcome.FAILURE,
          'credencial ausente',
        );
      }
      const source = await this.sourceConfig.execute(slug);
      if (!source)
        return this.unavailable(slug, UnknownReason.SOURCE_NOT_CONFIGURED);
      if (!source.isEnabled)
        return this.unavailable(
          slug,
          UnknownReason.SOURCE_DISABLED,
          SourceOutcome.DISABLED,
        );
      const key = { namespace: CacheNamespace[slug], identifier: cnpj };
      const ttl = await this.ttl.execute(slug);
      const cached = CacheSchema.safeParse(await this.cache.get(key));
      if (cached.success) {
        const collectedAt = new Date(cached.data.collectedAt);
        const age = Date.now() - collectedAt.getTime();
        if (
          age >= 0 &&
          age < ttl * 1000 &&
          cached.data.sanctions.every((s) => s.cnpj === cnpj)
        ) {
          return this.answered(cached.data.sanctions, collectedAt);
        }
      }

      const collectedAt = new Date();
      const sanctions = new Map<string, CguSanction>();
      const seen = new Set<string>();
      for (let page = 1; page <= CGU_MAX_PAGES; page++) {
        const response = await this.request.execute({
          slug,
          segments: [],
          cnpj,
          context,
          query: { codigoSancionado: cnpj, pagina: String(page) },
          rateLimitGroup: CGU_RATE_LIMIT_GROUP,
          headers: {
            'chave-api-dados': credential,
          },
        });
        if (response.outcome !== SourceOutcome.SUCCESS) {
          // 404 aqui significa endpoint/página inválida; só [] em HTTP 200 prova ausência.
          return this.unavailable(
            slug,
            unknownReasonOf(response),
            response.outcome === SourceOutcome.NOT_FOUND
              ? SourceOutcome.FAILURE
              : response.outcome,
          );
        }
        if (response.status !== 200)
          return this.unavailable(slug, UnknownReason.UNEXPECTED_STATUS);
        let parsed: ReturnType<typeof readCguPage>;
        try {
          parsed = readCguPage(response.body, cnpj);
        } catch {
          // Só o leitor da página lança por formato: aqui a fonte mudou de contrato.
          return this.unavailable(slug, UnknownReason.CONTRACT_MISMATCH);
        }
        if (parsed.ids.length === 0) {
          const result = [...sanctions.values()];
          await this.cache.set(
            key,
            { collectedAt: collectedAt.toISOString(), sanctions: result },
            ttl,
          );
          return this.answered(result, collectedAt);
        }
        const fingerprint = [...parsed.ids].sort().join(',');
        if (seen.has(fingerprint))
          return this.unavailable(slug, UnknownReason.PAGINATION_LIMIT);
        seen.add(fingerprint);
        for (const sanction of parsed.sanctions)
          sanctions.set(sanction.id, sanction);
      }
      return this.unavailable(slug, UnknownReason.PAGINATION_LIMIT);
    } catch (error) {
      // Não propaga erros do transporte com headers, chave ou corpo da resposta:
      // o log leva só o nome da exceção e a pilha (logSourceUnknown).
      return this.unavailable(
        slug,
        UnknownReason.UNEXPECTED_ERROR,
        SourceOutcome.FAILURE,
        undefined,
        error,
      );
    }
  }

  private answered(
    sanctions: CguSanction[],
    collectedAt: Date,
  ): CguLookupResult {
    return sanctions.length
      ? { status: 'FOUND', data: sanctions, collectedAt }
      : { status: 'NOT_FOUND', collectedAt };
  }

  private unavailable(
    slug: CguSlug,
    unknown: UnknownReason,
    reason: SourceUnavailableReason = SourceOutcome.FAILURE,
    message = 'Consulta CGU indisponível ou fora do contrato esperado.',
    error?: unknown,
  ): CguLookupResult {
    logSourceUnknown(this.logger, slug, unknown, error);

    return {
      status: 'UNAVAILABLE',
      reason,
      message,
    };
  }
}
