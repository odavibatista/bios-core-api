import { EvidenceCategory, EvidenceSignal } from '@prisma/client';
import { faker } from '@test/support/faker.js';
import {
  CalculateOdsScoresRequestSchema,
  CalculatedOdsScoreSchema,
} from './calculate-ods-scores.dto.js';

describe('contrato de cálculo por ODS', () => {
  it('normaliza CNPJ mascarado e rejeita um identificador inválido', () => {
    expect(
      CalculateOdsScoresRequestSchema.parse({ cnpj: '11.222.333/0001-81' }),
    ).toEqual({ cnpj: '11222333000181' });
    expect(
      CalculateOdsScoresRequestSchema.safeParse({ cnpj: 'invalido' }).success,
    ).toBe(false);
  });

  it('exige que contagem e índice reproduzam as contribuições', () => {
    const contribution = {
      evidenceId: faker.database.mongodbObjectId(),
      category: EvidenceCategory.INFRACAO_AMBIENTAL,
      signal: EvidenceSignal.NEGATIVE,
      weight: 40,
      points: -40,
    };
    const score = {
      cnpj: '11222333000181',
      odsId: faker.database.mongodbObjectId(),
      odsNumber: 15,
      scoreValue: -40,
      confidenceValue: 0.4,
      evidenceCount: 1,
      contributions: [contribution],
      rulesVersion: 'rf10-v1',
      calculatedAt: new Date(),
    };
    expect(CalculatedOdsScoreSchema.safeParse(score).success).toBe(true);
    expect(
      CalculatedOdsScoreSchema.safeParse({ ...score, scoreValue: -35 }).success,
    ).toBe(false);
    expect(
      CalculatedOdsScoreSchema.safeParse({ ...score, evidenceCount: 2 })
        .success,
    ).toBe(false);
    expect(
      CalculatedOdsScoreSchema.safeParse({ ...score, confidenceValue: 1.01 })
        .success,
    ).toBe(false);
  });
});
