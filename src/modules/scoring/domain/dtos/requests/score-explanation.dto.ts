import {
  EvidenceCategory,
  EvidenceSignal,
  EvidenceState,
} from '@prisma/client';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import { EvidenceSourceUrlSchema } from '@modules/evidences/domain/evidence-provenance.js';
import { z } from 'zod';
import { ODS_COVERAGE_STATUSES } from '../../ods-coverage-rules.js';

export const ScoreExplanationRequestSchema = z
  .object({
    cnpj: z.string().transform((value, ctx) => {
      const cnpj = parseCnpj(value);
      if (cnpj) return cnpj;
      ctx.addIssue({ code: 'custom', message: 'CNPJ invalido.' });
      return z.NEVER;
    }),
    odsNumber: z
      .union([
        z.string().regex(/^\d+$/, 'Numero do ODS invalido.').transform(Number),
        z.number(),
      ])
      .pipe(z.number().int().positive()),
  })
  .strict();

export const ScoreExplanationResponseSchema = z
  .object({
    cnpj: z.string(),
    ods_number: z.number().int().positive(),
    index_status: z.enum(['AVAILABLE', 'UNAVAILABLE']),
    score_value: z.number().min(-100).max(100).nullable(),
    confidence_value: z.number().min(0).max(1),
    evidence_count: z.number().int().nonnegative(),
    coverage_status: z.enum(ODS_COVERAGE_STATUSES).nullable(),
    sources_without_records: z.array(z.string().min(1)),
    rules_version: z.string().min(1),
    calculated_at: z.iso.datetime(),
    contributions: z.array(
      z
        .object({
          evidence: z
            .object({
              id: z.string().regex(/^[0-9a-f]{24}$/),
              category: z.enum(EvidenceCategory),
              source_slug: z.string().min(1),
              source: z.string().min(1),
              state: z
                .literal(EvidenceState.CONFIRMED)
                .describe(
                  'Estado da evidência quando contribuiu para o índice',
                ),
              current_state: z.enum(EvidenceState),
              source_reference: z.string().trim().min(1).nullable(),
              source_url: EvidenceSourceUrlSchema.nullable(),
              collected_at: z.iso.datetime(),
              valid_until: z.iso.datetime(),
            })
            .strict(),
          weight: z.number().positive(),
          weight_reason: z
            .enum(['CGU_SANCTION_EXPIRED', 'IBAMA_EMBARGO_LIFTED'])
            .nullable(),
          signal: z.enum(EvidenceSignal),
          points: z.number().min(-100).max(100),
        })
        .strict(),
    ),
  })
  .strict();

export type ScoreExplanationRequest = z.input<
  typeof ScoreExplanationRequestSchema
>;
export type ScoreExplanationResponse = z.infer<
  typeof ScoreExplanationResponseSchema
>;
