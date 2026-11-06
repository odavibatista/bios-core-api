import { EvidenceCategory, ScoreMovementCause } from '@prisma/client';
import { z } from 'zod';
import { OdsEvolutionStatus } from '@modules/scoring/domain/ods-evolution.js';

const EvolutionEvidenceSchema = z
  .object({
    id: z.string(),
    category: z.enum(EvidenceCategory),
    source_slug: z.string(),
    source: z.string(),
    summary: z.string().nullable(),
    source_reference: z.string().nullable(),
    source_url: z.string().nullable(),
  })
  .strict()
  .describe('A evidência que causou o degrau')
  .meta({ id: 'IndexEvolutionEvidence' });

const EvolutionStepSchema = z
  .object({
    date: z.iso
      .datetime()
      .describe('Fim do dia em que o índice passou a valer'),
    score_value: z.number().min(-100).max(100),
    cause: z.enum(ScoreMovementCause),
    evidence: EvolutionEvidenceSchema,
    evidence_count: z
      .number()
      .int()
      .positive()
      .describe('Quantas evidências mudaram o índice nessa data'),
  })
  .strict()
  .meta({ id: 'IndexEvolutionStep' });

const OdsEvolutionSchema = z
  .object({
    ods_number: z.number().int().positive(),
    status: z
      .enum(OdsEvolutionStatus)
      .describe('Por que a evolução aparece ou não'),
    steps: z
      .array(EvolutionStepSchema)
      .describe('Degraus em ordem cronológica; vazio fora de AVAILABLE'),
  })
  .strict()
  .meta({ id: 'OdsIndexEvolution' });

/**
 * Evolução do índice de uma empresa (UC07, RF36). Não traz variação nem comparação com outras
 * empresas (IND03, d): só o índice em cada data e a evidência que o causou.
 */
export const CompanyIndexEvolutionResponseSchema = z
  .object({
    cnpj: z.string(),
    reconstructed: z
      .literal(true)
      .describe(
        'A série é reconstruída com as regras vigentes, a partir das evidências atuais',
      ),
    ods: z.array(OdsEvolutionSchema),
  })
  .strict()
  .describe('Evolução do índice da empresa, por ODS')
  .meta({ id: 'CompanyIndexEvolution' });

export type CompanyIndexEvolution = z.infer<
  typeof CompanyIndexEvolutionResponseSchema
>;
