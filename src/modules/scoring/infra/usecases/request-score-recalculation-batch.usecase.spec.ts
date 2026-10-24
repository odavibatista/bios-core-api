import { Test } from '@nestjs/testing';
import { buildDistinctCnpjs } from '@test/support/cnpj.js';
import { SCORES_REQUEST_CONCURRENCY } from '../../domain/ods-scoring-job.dto.js';
import { RequestScoreRecalculationBatchUseCase } from './request-score-recalculation-batch.usecase.js';
import { RequestScoreRecalculationUseCase } from './request-score-recalculation.usecase.js';

describe('RequestScoreRecalculationBatchUseCase', () => {
  const request = {
    execute: vi.fn<RequestScoreRecalculationUseCase['execute']>(),
  };
  let useCase: RequestScoreRecalculationBatchUseCase;

  beforeEach(async () => {
    request.execute.mockResolvedValue('REQUESTED');

    const moduleRef = await Test.createTestingModule({
      providers: [
        RequestScoreRecalculationBatchUseCase,
        { provide: RequestScoreRecalculationUseCase, useValue: request },
      ],
    }).compile();

    useCase = moduleRef.get(RequestScoreRecalculationBatchUseCase);
  });

  it('pede um job por empresa, sem espera', async () => {
    const cnpjs = buildDistinctCnpjs(3);

    await expect(useCase.execute(cnpjs)).resolves.toEqual({
      requested: 3,
      degraded: 0,
    });

    expect(request.execute.mock.calls.map(([{ cnpj }]) => cnpj)).toEqual(cnpjs);
    for (const [call] of request.execute.mock.calls) {
      expect(call.wait).toBeUndefined();
    }
  });

  it('CNPJ repetido vale um pedido só', async () => {
    const [one, two] = buildDistinctCnpjs(2);

    await expect(useCase.execute([one, two, one, one])).resolves.toEqual({
      requested: 2,
      degraded: 0,
    });
  });

  it('lista vazia não pede nada', async () => {
    await expect(useCase.execute([])).resolves.toEqual({
      requested: 0,
      degraded: 0,
    });

    expect(request.execute).not.toHaveBeenCalled();
  });

  it('conta separadamente os pedidos que a fila não aceitou', async () => {
    const cnpjs = buildDistinctCnpjs(4);
    request.execute.mockImplementation(({ cnpj }) =>
      Promise.resolve(cnpj === cnpjs[1] ? 'DEGRADED' : 'REQUESTED'),
    );

    await expect(useCase.execute(cnpjs)).resolves.toEqual({
      requested: 3,
      degraded: 1,
    });
  });

  it('publica em lotes: nunca mais pedidos ao mesmo tempo que o limite', async () => {
    const cnpjs = buildDistinctCnpjs(SCORES_REQUEST_CONCURRENCY * 2 + 3);
    let inFlight = 0;
    let peak = 0;
    request.execute.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;

      return 'REQUESTED';
    });

    const result = await useCase.execute(cnpjs);

    expect(result.requested).toBe(cnpjs.length);
    expect(peak).toBe(SCORES_REQUEST_CONCURRENCY);
  });

  it('aceita qualquer iterável, não só array', async () => {
    const cnpjs = new Set(buildDistinctCnpjs(2));

    await expect(useCase.execute(cnpjs)).resolves.toMatchObject({
      requested: 2,
    });
  });
});
