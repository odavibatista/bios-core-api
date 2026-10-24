import {
  ScoreExplanationStaleException,
  ScoreNotFoundException,
} from '../../domain/dtos/errors/score-explanation.errors.js';
import type { ScoreExplanationResponse } from '../../domain/dtos/requests/score-explanation.dto.js';
import { GetCompanyOdsScoresUseCase } from './get-company-ods-scores.usecase.js';

describe('GetCompanyOdsScoresUseCase', () => {
  const CNPJ = '11222333000181';
  const scores = { findActiveOds: vi.fn() };
  const explanation = { execute: vi.fn() };
  let useCase: GetCompanyOdsScoresUseCase;

  function explained(odsNumber: number): ScoreExplanationResponse {
    return {
      cnpj: CNPJ,
      ods_number: odsNumber,
      index_status: 'UNAVAILABLE',
      score_value: null,
      confidence_value: 0.4,
      evidence_count: 0,
      coverage_status: 'NO_RECORDS_IN_ALL_SOURCES',
      sources_without_records: ['IBAMA'],
      rules_version: 'rf10-rf11-v3',
      calculated_at: '2026-10-20T10:00:00.000Z',
      contributions: [],
    };
  }

  beforeEach(() => {
    scores.findActiveOds.mockResolvedValue([
      { id: 'b', number: 15 },
      { id: 'a', number: 13 },
    ]);
    explanation.execute.mockImplementation(
      ({ odsNumber }: { odsNumber: number }) =>
        Promise.resolve(explained(odsNumber)),
    );
    useCase = new GetCompanyOdsScoresUseCase(
      scores as never,
      explanation as never,
    );
  });

  it('lista os ODS ativos em ordem de número, com a explicação de cada um', async () => {
    const result = await useCase.execute(CNPJ);

    expect(result.map((item) => item.ods_number)).toEqual([13, 15]);
    expect(result[0]).toMatchObject({
      calculation_status: 'CALCULATED',
      confidence_value: 0.4,
      score_value: null,
      rules_version: 'rf10-rf11-v3',
      contributions: [],
    });
    expect(result[0]).not.toHaveProperty('cnpj');
    expect(explanation.execute).toHaveBeenCalledWith({
      cnpj: CNPJ,
      odsNumber: 13,
    });
  });

  it.each([
    ['sem retrato gravado', new ScoreNotFoundException()],
    [
      'com retrato que deixou de ser auditável',
      new ScoreExplanationStaleException(),
    ],
  ])(
    'ODS %s sai PENDING, sem número, e não derruba os demais',
    async (_, error) => {
      explanation.execute.mockImplementation(
        ({ odsNumber }: { odsNumber: number }) =>
          odsNumber === 13
            ? Promise.reject(error)
            : Promise.resolve(explained(15)),
      );

      const result = await useCase.execute(CNPJ);

      expect(result[0]).toEqual({
        ods_number: 13,
        calculation_status: 'PENDING',
        index_status: 'UNAVAILABLE',
        score_value: null,
        confidence_value: null,
        evidence_count: null,
        coverage_status: null,
        sources_without_records: [],
        rules_version: null,
        calculated_at: null,
        contributions: [],
      });
      expect(result[1].calculation_status).toBe('CALCULATED');
    },
  );

  it('propaga falha de infraestrutura em vez de disfarçá-la de pendência', async () => {
    explanation.execute.mockRejectedValue(new Error('banco fora'));

    await expect(useCase.execute(CNPJ)).rejects.toThrow('banco fora');
  });

  it('sem ODS ativo, devolve lista vazia', async () => {
    scores.findActiveOds.mockResolvedValue([]);

    await expect(useCase.execute(CNPJ)).resolves.toEqual([]);
  });
});
