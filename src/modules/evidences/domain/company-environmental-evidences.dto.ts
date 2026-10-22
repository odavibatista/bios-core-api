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
                ods_number: z.number().int(),
                state: z.enum(EvidenceState),
                signal: z.enum(EvidenceSignal).nullable(),
                summary: z.string().nullable(),
                source_reference: z.string().nullable(),
                source_url: z.string().nullable(),
                details: z.json().nullable(),
                published_at: z.iso.datetime().nullable(),
                collected_at: z.iso.datetime(),
                valid_until: z.iso.datetime(),
              })
              .strict(),
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
        .map((e) => ({
          id: e.id,
          source_slug: e.sourceSlug,
          ods_number: e.odsNumber,
          state: e.state,
          signal: e.state === EvidenceState.CONFIRMED ? e.signal : null,
          summary: e.summary,
          source_reference: e.sourceReference,
          source_url: e.sourceUrl,
          details: e.details,
          published_at: e.publishedAt?.toISOString() ?? null,
          collected_at: e.collectedAt.toISOString(),
          valid_until: e.validUntil.toISOString(),
        })),
    })),
  });
}
