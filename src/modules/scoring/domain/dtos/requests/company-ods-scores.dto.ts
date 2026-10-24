import { z } from 'zod';
import { ODS_COVERAGE_STATUSES } from '../../ods-coverage-rules.js';
import { ScoreExplanationResponseSchema } from './score-explanation.dto.js';

/**
 * Índice e confiança de um ODS no perfil completo (UC07, RF10–RF12).
 *
 * `calculation_status` separa "calculado" de "ainda sem retrato confiável": enquanto o
 * recálculo não terminou (ou o retrato guardado deixou de ser auditável), o ODS aparece
 * como `PENDING`, sem número algum. Pendência nunca é nota baixa (IND02).
 */
export const CompanyOdsScoreSchema = z
  .object({
    ods_number: z.number().int().positive(),
    calculation_status: z
      .enum(['CALCULATED', 'PENDING'])
      .describe('PENDING: o índice deste ODS ainda não pôde ser exibido'),
    index_status: z.enum(['AVAILABLE', 'UNAVAILABLE']),
    score_value: z.number().min(-100).max(100).nullable(),
    confidence_value: z
      .number()
      .min(0)
      .max(1)
      .nullable()
      .describe('Confiança (RF11), sempre separada do índice'),
    evidence_count: z.number().int().nonnegative().nullable(),
    coverage_status: z.enum(ODS_COVERAGE_STATUSES).nullable(),
    sources_without_records: z.array(z.string().min(1)),
    rules_version: z.string().min(1).nullable(),
    calculated_at: z.iso.datetime().nullable(),
    contributions: ScoreExplanationResponseSchema.shape.contributions.describe(
      'Explicação do índice (RF12): evidências que o compuseram, com peso e sinal',
    ),
  })
  .strict()
  .describe('Índice de aderência e confiança de um ODS');

export type CompanyOdsScore = z.infer<typeof CompanyOdsScoreSchema>;
