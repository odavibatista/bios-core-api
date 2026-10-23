import {
  EvidenceCategory,
  EvidenceSignal,
  EvidenceState,
} from '@prisma/client';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { storedEvidenceFactory } from '@test/factories/evidences/evidence.factory.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import type { OdsScoreSnapshot } from '../../domain/dtos/repositories/ods-score.repository.js';
import { OdsScoreRepository } from '../../domain/dtos/repositories/ods-score.repository.js';
import {
  ScoreExplanationStaleException,
  ScoreNotFoundException,
} from '../../domain/dtos/errors/score-explanation.errors.js';
import { GetScoreExplanationUseCase } from './get-score-explanation.usecase.js';

describe('GetScoreExplanationUseCase', () => {
  const cnpj = buildCnpj();
  const evidence = storedEvidenceFactory.build({
    cnpj,
    odsNumber: 15,
    sourceSlug: 'CGU_CEIS',
    sourceName: 'CGU — CEIS',
    category: EvidenceCategory.CONDUTA_ADMINISTRATIVA,
    signal: EvidenceSignal.NEGATIVE,
    state: EvidenceState.CONFIRMED,
    sourceReference: '370679',
    sourceUrl: null,
  });
  const snapshot: OdsScoreSnapshot = {
    cnpj,
    odsNumber: 15,
    scoreValue: -5,
    confidenceValue: 0.2,
    evidenceCount: 1,
    contributions: [
      {
        evidenceId: evidence.id,
        category: EvidenceCategory.CONDUTA_ADMINISTRATIVA,
        signal: EvidenceSignal.NEGATIVE,
        weight: 5,
        weightReason: null,
        points: -5,
      },
    ],
    rulesVersion: 'rf10-rf11-v3',
    calculatedAt: new Date('2026-10-22T12:00:00.000Z'),
  };
  const scores = {
    findByCnpjAndOdsNumber:
      vi.fn<OdsScoreRepository['findByCnpjAndOdsNumber']>(),
  };
  const evidences = {
    execute: vi.fn<ListCompanyEvidencesUseCase['execute']>(),
  };
  const useCase = new GetScoreExplanationUseCase(
    scores as unknown as OdsScoreRepository,
    evidences as unknown as ListCompanyEvidencesUseCase,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    scores.findByCnpjAndOdsNumber.mockResolvedValue(snapshot);
    evidences.execute.mockResolvedValue([evidence]);
  });

  it('explica o retrato com fonte, peso, sinal e soma exata, sem veredito', async () => {
    const result = await useCase.execute({ cnpj, odsNumber: '15' });
    expect(scores.findByCnpjAndOdsNumber).toHaveBeenCalledWith(cnpj, 15);
    expect(evidences.execute).toHaveBeenCalledWith(cnpj);
    expect(result).toMatchObject({
      cnpj,
      ods_number: 15,
      index_status: 'AVAILABLE',
      score_value: -5,
      confidence_value: 0.2,
      evidence_count: 1,
      rules_version: 'rf10-rf11-v3',
      contributions: [
        {
          evidence: {
            id: evidence.id,
            category: 'CONDUTA_ADMINISTRATIVA',
            source_slug: 'CGU_CEIS',
            source: 'CGU — CEIS',
            state: 'CONFIRMED',
            current_state: 'CONFIRMED',
            source_reference: '370679',
          },
          weight: 5,
          weight_reason: null,
          signal: 'NEGATIVE',
          points: -5,
        },
      ],
    });
    expect(
      result.contributions.reduce((total, item) => total + item.points, 0),
    ).toBe(result.score_value);
    expect(JSON.stringify(result)).not.toMatch(/sustent[aá]vel/i);
  });

  it('indica índice indisponível sem consultar evidências', async () => {
    scores.findByCnpjAndOdsNumber.mockResolvedValue({
      ...snapshot,
      scoreValue: null,
      confidenceValue: 0,
      evidenceCount: 0,
      contributions: [],
    });
    await expect(
      useCase.execute({ cnpj, odsNumber: '15' }),
    ).resolves.toMatchObject({
      index_status: 'UNAVAILABLE',
      score_value: null,
      confidence_value: 0,
      contributions: [],
    });
    expect(evidences.execute).not.toHaveBeenCalled();
  });

  it('distingue empresa/ODS sem score de índice calculado indisponível', async () => {
    scores.findByCnpjAndOdsNumber.mockResolvedValue(null);
    await expect(
      useCase.execute({ cnpj, odsNumber: '13' }),
    ).rejects.toBeInstanceOf(ScoreNotFoundException);
    expect(evidences.execute).not.toHaveBeenCalled();
  });

  it('não aceita contribuição órfã, inconsistente ou sem proveniência', async () => {
    for (const rows of [
      [],
      [{ ...evidence, odsNumber: 13 }],
      [{ ...evidence, category: EvidenceCategory.INFRACAO_AMBIENTAL }],
      [{ ...evidence, signal: EvidenceSignal.POSITIVE }],
      [{ ...evidence, state: EvidenceState.UNKNOWN }],
      [{ ...evidence, sourceReference: null, sourceUrl: null }],
      [
        {
          ...evidence,
          sourceReference: null,
          sourceUrl: 'http://fonte.example/registro',
        },
      ],
    ]) {
      evidences.execute.mockResolvedValue(rows);
      await expect(
        useCase.execute({ cnpj, odsNumber: '15' }),
      ).rejects.toBeInstanceOf(ScoreExplanationStaleException);
    }
  });

  it('recusa soma, contagem e ID duplicado inconsistentes', async () => {
    for (const corrupt of [
      { ...snapshot, scoreValue: -10 },
      { ...snapshot, evidenceCount: 2 },
      {
        ...snapshot,
        contributions: [snapshot.contributions[0], snapshot.contributions[0]],
        scoreValue: -10,
        evidenceCount: 2,
      },
    ]) {
      scores.findByCnpjAndOdsNumber.mockResolvedValue(corrupt);
      await expect(
        useCase.execute({ cnpj, odsNumber: '15' }),
      ).rejects.toBeInstanceOf(ScoreExplanationStaleException);
    }
    expect(evidences.execute).not.toHaveBeenCalled();
  });

  it('mostra estado atual OUTDATED sem reescrever o estado da contribuição', async () => {
    evidences.execute.mockResolvedValue([
      { ...evidence, state: EvidenceState.OUTDATED },
    ]);
    const result = await useCase.execute({ cnpj, odsNumber: '15' });
    expect(result.contributions[0].evidence.state).toBe('CONFIRMED');
    expect(result.contributions[0].evidence.current_state).toBe('OUTDATED');
  });

  it('valida CNPJ e ODS antes de qualquer leitura', async () => {
    await expect(
      useCase.execute({ cnpj: 'invalido', odsNumber: '15' }),
    ).rejects.toThrow();
    await expect(useCase.execute({ cnpj, odsNumber: '-1' })).rejects.toThrow();
    expect(scores.findByCnpjAndOdsNumber).not.toHaveBeenCalled();
  });
});
