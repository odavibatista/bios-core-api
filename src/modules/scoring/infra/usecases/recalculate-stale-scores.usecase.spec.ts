import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { buildDistinctCnpjs } from '@test/support/cnpj.js';
import { OdsScoreRepository } from '../../domain/dtos/repositories/ods-score.repository.js';
import { ODS_SCORE_RULES_VERSION } from '../../domain/ods-score-rules.js';
import { STALE_SCORES_PAGE_SIZE } from '../../domain/ods-scoring-job.dto.js';
import { RecalculateStaleScoresUseCase } from './recalculate-stale-scores.usecase.js';
import { RequestScoreRecalculationBatchUseCase } from './request-score-recalculation-batch.usecase.js';

describe('RecalculateStaleScoresUseCase', () => {
  const scores = {
    findCnpjsWithOtherRulesVersion:
      vi.fn<OdsScoreRepository['findCnpjsWithOtherRulesVersion']>(),
  };
  const batch = {
    execute: vi.fn<RequestScoreRecalculationBatchUseCase['execute']>(),
  };
  let useCase: RecalculateStaleScoresUseCase;

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    batch.execute.mockImplementation((cnpjs) =>
      Promise.resolve({ requested: [...cnpjs].length, degraded: 0 }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        RecalculateStaleScoresUseCase,
        { provide: OdsScoreRepository, useValue: scores },
        { provide: RequestScoreRecalculationBatchUseCase, useValue: batch },
      ],
    }).compile();

    useCase = moduleRef.get(RecalculateStaleScoresUseCase);
  });

  it('sem empresa na versão antiga, não pede nada', async () => {
    scores.findCnpjsWithOtherRulesVersion.mockResolvedValue([]);

    await expect(useCase.execute()).resolves.toEqual({ requested: 0 });

    expect(batch.execute).not.toHaveBeenCalled();
    expect(
      scores.findCnpjsWithOtherRulesVersion,
    ).toHaveBeenCalledExactlyOnceWith(
      ODS_SCORE_RULES_VERSION,
      null,
      STALE_SCORES_PAGE_SIZE,
    );
  });

  it('percorre as páginas por cursor de CNPJ até esgotar, pedindo o recálculo de cada uma', async () => {
    const [a, b, c, d, e] = buildDistinctCnpjs(5).sort();
    scores.findCnpjsWithOtherRulesVersion
      .mockResolvedValueOnce([a, b])
      .mockResolvedValueOnce([c, d])
      .mockResolvedValueOnce([e])
      .mockResolvedValueOnce([]);

    await expect(useCase.execute()).resolves.toEqual({ requested: 5 });

    expect(
      scores.findCnpjsWithOtherRulesVersion.mock.calls.map(
        ([, cursor]) => cursor,
      ),
    ).toEqual([null, b, d, e]);
    expect(batch.execute.mock.calls.map(([page]) => [...page])).toEqual([
      [a, b],
      [c, d],
      [e],
    ]);
  });

  it('pedido que a fila não aceitou faz a varredura falhar no fim, para o BullMQ repetir', async () => {
    const [a, b] = buildDistinctCnpjs(2).sort();
    scores.findCnpjsWithOtherRulesVersion
      .mockResolvedValueOnce([a, b])
      .mockResolvedValueOnce([]);
    batch.execute.mockResolvedValue({ requested: 1, degraded: 1 });

    await expect(useCase.execute()).rejects.toThrow(
      /não aceitou o recálculo de 1/,
    );
  });

  it('falha do banco na leitura propaga', async () => {
    scores.findCnpjsWithOtherRulesVersion.mockRejectedValue(
      new Error('banco fora'),
    );

    await expect(useCase.execute()).rejects.toThrow('banco fora');
  });
});
