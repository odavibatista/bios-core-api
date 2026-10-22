import {
  EvidenceSourceUrlSchema,
  projectEvidenceProvenance,
} from './evidence-provenance.js';
import { z } from 'zod';
import {
  EvidenceCategory,
  EvidenceSignal,
  EvidenceState,
} from '@prisma/client';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import type { StoredEvidence } from './dtos/repositories/evidence.repository.js';
export const CompanyEnvironmentalEvidencesRequestSchema = z
  .object({
    cnpj: z.string().transform((value, ctx) => {
      const cnpj = parseCnpj(value);
      if (cnpj) return cnpj;
      ctx.addIssue({
        code: 'custom',
        message: 'CNPJ invalido para consultar evidencias.',
      });
      return z.NEVER;
    }),
  })
  .strict();
export const CompanyEnvironmentalEvidencesResponseSchema = z
  .object({
    cnpj: z.string(),
    categories: z.array(
      z
        .object({
          category: z.enum(EvidenceCategory),
          evidences: z.array(
            z
              .object({
                id: z.string(),
                source_slug: z.string(),
                source: z
                  .string()
                  .min(1)
                  .describe(
                    'Nome público do órgão/programa no catálogo de fontes',
                  ),
                ods_number: z.number().int(),
                state: z.enum(EvidenceState),
                signal: z.enum(EvidenceSignal).nullable(),
                summary: z.string().nullable(),
                source_reference: z.string().trim().min(1).nullable(),
                source_url: EvidenceSourceUrlSchema.nullable().describe(
                  'Link HTTPS original; pode exigir autenticação no órgão',
                ),
                details: z.json().nullable(),
                published_at: z.iso.datetime().nullable(),
                collected_at: z.iso.datetime(),
                valid_until: z.iso.datetime(),
              })
              .strict()
              .superRefine((evidence, ctx) => {
                if (
                  evidence.state === EvidenceState.CONFIRMED &&
                  !evidence.source_reference &&
                  !evidence.source_url
                )
                  ctx.addIssue({
                    code: 'custom',
                    path: ['source_reference'],
                    message:
                      'Evidência confirmada exige referência ou link rastreável.',
                  });
              }),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type CompanyEnvironmentalEvidencesResponse = z.infer<
  typeof CompanyEnvironmentalEvidencesResponseSchema
>;
export const ENVIRONMENTAL_SOURCE_SLUGS = [
  'IBAMA',
  'CGU_CEIS',
  'CGU_CNEP',
  'GHG_PROTOCOL',
] as const;
/** Projecao sem veredito ou pontuacao. Ausencia e desconhecimento nao tem sinal. */
export function groupCompanyEvidences(
  cnpj: string,
  stored: StoredEvidence[],
): CompanyEnvironmentalEvidencesResponse {
  const rows = stored.filter((e) =>
    ENVIRONMENTAL_SOURCE_SLUGS.some((slug) => slug === e.sourceSlug),
  );
  return CompanyEnvironmentalEvidencesResponseSchema.parse({
    cnpj,
    categories: Object.values(EvidenceCategory).map((category) => ({
      category,
      evidences: rows
        .filter((e) => e.category === category)
        .sort(
          (a, b) =>
            a.sourceSlug.localeCompare(b.sourceSlug) ||
            a.key.localeCompare(b.key),
        )
        .map((e) => {
          const provenance = projectEvidenceProvenance(e);
          return {
            id: e.id,
            source_slug: e.sourceSlug,
            source: e.sourceName,
            ods_number: e.odsNumber,
            state: provenance.state,
            signal:
              provenance.state === EvidenceState.CONFIRMED ? e.signal : null,
            summary: provenance.summary,
            source_reference: provenance.sourceReference,
            source_url: provenance.sourceUrl,
            details: provenance.details,
            published_at: e.publishedAt?.toISOString() ?? null,
            collected_at: e.collectedAt.toISOString(),
            valid_until: e.validUntil.toISOString(),
          };
        }),
    })),
  });
}
