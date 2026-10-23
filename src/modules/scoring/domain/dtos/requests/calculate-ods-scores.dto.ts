import { EvidenceCategory, EvidenceSignal } from '@prisma/client';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import { z } from 'zod';
import { ODS_COVERAGE_STATUSES } from '../../ods-coverage-rules.js';

export const CalculateOdsScoresRequestSchema = z
  .object({
    cnpj: z.string().transform((value, ctx) => {
      const cnpj = parseCnpj(value);
      if (cnpj) return cnpj;
      ctx.addIssue({
        code: 'custom',
        message: 'CNPJ invalido para calcular indices.',
      });
      return z.NEVER;
    }),
  })
  .strict();

export const OdsScoreContributionSchema = z
  .object({
    evidenceId: z.string().regex(/^[0-9a-f]{24}$/),
    category: z.enum(EvidenceCategory),
    signal: z.enum(EvidenceSignal),
    weight: z.number().positive(),
    weightReason: z
      .enum(['CGU_SANCTION_EXPIRED', 'IBAMA_EMBARGO_LIFTED'])
      .nullable(),
    points: z.number().min(-100).max(100),
  })
  .strict();

export const CalculatedOdsScoreSchema = z
  .object({
    cnpj: z.string(),
    odsId: z.string().regex(/^[0-9a-f]{24}$/),
    odsNumber: z.number().int().positive(),
    scoreValue: z.number().min(-100).max(100).nullable(),
    confidenceValue: z.number().min(0).max(1),
    evidenceCount: z.number().int().nonnegative(),
    contributions: z.array(OdsScoreContributionSchema),
    coverageStatus: z.enum(ODS_COVERAGE_STATUSES),
    sourcesWithoutRecords: z.array(z.string().min(1)),
    rulesVersion: z.string().min(1),
    calculatedAt: z.date(),
  })
  .strict()
  .superRefine((score, ctx) => {
    const sum = score.contributions.reduce(
      (total, item) => total + item.points,
      0,
    );
    if (score.scoreValue !== (score.contributions.length ? sum : null))
      ctx.addIssue({
        code: 'custom',
        path: ['scoreValue'],
        message: 'O indice deve reproduzir a soma das contribuicoes.',
      });
    if (score.evidenceCount !== score.contributions.length)
      ctx.addIssue({
        code: 'custom',
        path: ['evidenceCount'],
        message: 'A contagem deve corresponder as contribuicoes.',
      });
    if (
      (score.coverageStatus === 'HAS_RECORDS') !==
      score.contributions.length > 0
    )
      ctx.addIssue({
        code: 'custom',
        path: ['coverageStatus'],
        message: 'A cobertura deve corresponder as contribuicoes.',
      });
  });

export type CalculatedOdsScore = z.infer<typeof CalculatedOdsScoreSchema>;
