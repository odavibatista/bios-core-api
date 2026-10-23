import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { QueueTimeoutException } from '@shared/domain/errors/queue-timeout.exception.js';
import { QueueProvider } from '@shared/domain/providers/queue.provider.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { faker } from '@test/support/faker.js';
import { RECALCULATE_SCORES_JOB } from '../../domain/ods-scoring-job.dto.js';
import { RequestScoreRecalculationUseCase } from './request-score-recalculation.usecase.js';

describe('RequestScoreRecalculationUseCase', () => {
  const queue = {
    enqueue: vi.fn<QueueProvider['enqueue']>(),
    enqueueAndWait: vi.fn<QueueProvider['enqueueAndWait']>(),
  };
  const cnpj = buildCnpj();
  let useCase: RequestScoreRecalculationUseCase;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    queue.enqueue.mockResolvedValue(undefined);
    queue.enqueueAndWait.mockResolvedValue({ status: 'CALCULATED' });
    warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RequestScoreRecalculationUseCase,
        { provide: QueueProvider, useValue: queue },
      ],
    }).compile();

    useCase = moduleRef.get(RequestScoreRecalculationUseCase);
  });

  it('só publica o pedido, com jobId do CNPJ e coalescência exata', async () => {
    await expect(useCase.execute({ cnpj })).resolves.toBe('REQUESTED');

    expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith(
      QueueName.ODS_SCORING,
      RECALCULATE_SCORES_JOB,
      { cnpj },
      { jobId: `scores-${cnpj}`, coalesce: true },
    );
    expect(queue.enqueueAndWait).not.toHaveBeenCalled();
  });

  it('com wait, publica e espera o recálculo, no prazo informado', async () => {
    const timeoutMs = faker.number.int({ min: 500, max: 9_000 });

    await expect(
      useCase.execute({ cnpj, wait: true, timeoutMs }),
    ).resolves.toBe('CALCULATED');

    expect(queue.enqueueAndWait).toHaveBeenCalledExactlyOnceWith(
      QueueName.ODS_SCORING,
      RECALCULATE_SCORES_JOB,
      { cnpj },
      { jobId: `scores-${cnpj}`, coalesce: true, timeoutMs },
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('fila que não aceita o pedido vira DEGRADED, sem lançar', async () => {
    queue.enqueue.mockRejectedValue(new Error('redis fora'));

    await expect(useCase.execute({ cnpj })).resolves.toBe('DEGRADED');
  });

  it('prazo estourado ou job falho na espera vira DEGRADED, sem lançar', async () => {
    queue.enqueueAndWait.mockRejectedValue(
      new QueueTimeoutException(
        QueueName.ODS_SCORING,
        RECALCULATE_SCORES_JOB,
        1,
      ),
    );

    await expect(useCase.execute({ cnpj, wait: true })).resolves.toBe(
      'DEGRADED',
    );
  });

  it('o aviso leva só o tipo do erro: nem o CNPJ nem a mensagem da fila', async () => {
    queue.enqueue.mockRejectedValue(
      new Error(`falha com ${cnpj} em redis://x`),
    );

    await useCase.execute({ cnpj });

    expect(warn).toHaveBeenCalledOnce();
    const logged = String(warn.mock.calls[0][0]);
    expect(logged).toContain('Error');
    expect(logged).not.toContain(cnpj);
    expect(logged).not.toContain('redis://');
  });

  it('valor lançado que não é Error também degrada', async () => {
    queue.enqueue.mockRejectedValue('texto solto');

    await expect(useCase.execute({ cnpj })).resolves.toBe('DEGRADED');
  });

  it('CNPJ que não é canônico é erro de quem chama: lança, e nada é publicado', async () => {
    await expect(
      useCase.execute({ cnpj: '11.222.333/0001-81' }),
    ).rejects.toThrow(/não canônico/);

    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
