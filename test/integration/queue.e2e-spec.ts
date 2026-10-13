import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { validateEnvironment } from '@shared/config/environment.config.js';
import {
  QUEUE_RETRY_POLICIES,
  QUEUE_SCHEDULES,
} from '@shared/config/queue.config.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { QueueJobFailedException } from '@shared/domain/errors/queue-job-failed.exception.js';
import { QueueTimeoutException } from '@shared/domain/errors/queue-timeout.exception.js';
import { QueueProvider } from '@shared/domain/providers/queue.provider.js';
import { RedisHealthProvider } from '@shared/domain/providers/redis-health.provider.js';
import { QueueModule } from '@shared/infra/modules/queue.module.js';
import { Queue, Worker } from 'bullmq';
import { inject } from 'vitest';
import {
  buildJobName,
  buildJobPayload,
  queueScheduleFactory,
} from '../factories/shared/queue-job.factory.js';
import { buildTestEnvironment } from '../support/environment.js';

const REDIS_URL = inject('testRedisUrl');

/**
 * Infraestrutura de filas contra um Redis real: prova que publicar, aguardar a
 * conclusão e agendar funcionam de ponta a ponta — comportamento do próprio
 * BullMQ, que nenhum dublê demonstra.
 *
 * Cada cenário usa uma fila diferente, para que o consumidor de um teste não
 * consuma o job de outro.
 */
describe.runIf(inject('redisAvailable'))('Filas com Redis real (e2e)', () => {
  let moduleRef: TestingModule;
  let queues: QueueProvider;
  const workers: Worker[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => validateEnvironment(buildTestEnvironment({ REDIS_URL })),
          ],
        }),
        QueueModule,
      ],
    }).compile();

    queues = moduleRef.get(QueueProvider);
  });

  afterAll(async () => {
    await Promise.all(workers.map((worker) => worker.close()));
    await moduleRef.close();
  });

  /** Consumidor temporário da fila, no papel do serviço de ingestão. */
  function consumeWith(
    queue: QueueName,
    process: (payload: unknown) => unknown,
  ): void {
    workers.push(
      new Worker(queue, ({ data }) => Promise.resolve(process(data)), {
        connection: { url: REDIS_URL, maxRetriesPerRequest: null },
      }),
    );
  }

  /** Acesso direto à fila, para inspecionar o que o provider deixou no Redis. */
  async function inspect<T>(
    name: QueueName,
    assertion: (queue: Queue) => Promise<T>,
  ): Promise<T> {
    const queue = new Queue(name, { connection: { url: REDIS_URL } });

    try {
      return await assertion(queue);
    } finally {
      await queue.close();
    }
  }

  it('reporta o Redis disponível', async () => {
    await expect(
      moduleRef.get(RedisHealthProvider).isAvailable(),
    ).resolves.toBe(true);
  });

  it('entrega a carga ao consumidor e devolve o resultado dele', async () => {
    const payload = buildJobPayload();
    const received: unknown[] = [];
    consumeWith(QueueName.ODS_SCORING, (data) => {
      received.push(data);
      return { processed: data };
    });

    const result = await queues.enqueueAndWait(
      QueueName.ODS_SCORING,
      buildJobName(),
      payload,
    );

    expect(result).toEqual({ processed: payload });
    expect(received).toEqual([payload]);
  });

  it('propaga o motivo quando o job esgota as tentativas', async () => {
    const { attempts } = QUEUE_RETRY_POLICIES[QueueName.COMPANY_PROFILE];
    const reason = 'fonte externa indisponível';
    let tries = 0;
    consumeWith(QueueName.COMPANY_PROFILE, () => {
      tries += 1;
      throw new Error(reason);
    });

    const attempt = queues.enqueueAndWait(
      QueueName.COMPANY_PROFILE,
      buildJobName(),
      buildJobPayload(),
      { timeoutMs: 12_000 },
    );

    await expect(attempt).rejects.toThrow(QueueJobFailedException);
    await expect(attempt).rejects.toMatchObject({ details: { reason } });
    // O backoff exponencial roda de verdade entre as tentativas.
    expect(tries).toBe(attempts);
  });

  it('estoura o prazo sem consumidor, e o job segue na fila', async () => {
    const jobName = buildJobName();

    await expect(
      queues.enqueueAndWait(
        QueueName.GHG_INVENTORY,
        jobName,
        buildJobPayload(),
        { timeoutMs: 1_000 },
      ),
    ).rejects.toThrow(QueueTimeoutException);

    // O prazo é de quem espera: o job continua disponível para consumo.
    const waiting = await inspect(QueueName.GHG_INVENTORY, (queue) =>
      queue.getWaiting(),
    );
    expect(waiting.map(({ name }) => name)).toContain(jobName);

    await inspect(QueueName.GHG_INVENTORY, (queue) =>
      queue.obliterate({ force: true }),
    );
  });

  it('publica sem aguardar quando o resultado não importa', async () => {
    const jobName = buildJobName();

    await queues.enqueue(QueueName.EMAIL_DISPATCH, jobName, buildJobPayload());

    const waiting = await inspect(QueueName.EMAIL_DISPATCH, (queue) =>
      queue.getWaiting(),
    );
    expect(waiting.map(({ name }) => name)).toContain(jobName);

    await inspect(QueueName.EMAIL_DISPATCH, (queue) =>
      queue.obliterate({ force: true }),
    );
  });

  describe('jobs repetíveis', () => {
    const queue = QueueName.ENVIRONMENTAL_EVIDENCES;

    it('não duplica o agendamento ao registrar o mesmo job de novo', async () => {
      const schedule = queueScheduleFactory.build({ queue });

      await queues.schedule(schedule);
      await queues.schedule(schedule);

      const schedulers = await inspect(queue, (target) =>
        target.getJobSchedulers(),
      );
      expect(schedulers.filter(({ key }) => key === schedule.id)).toHaveLength(
        1,
      );

      await inspect(queue, (target) => target.removeJobScheduler(schedule.id));
    });

    it('registra o agendamento declarado na configuração', async () => {
      const [declared] = QUEUE_SCHEDULES;

      await queues.schedule(declared);

      const schedulers = await inspect(declared.queue, (target) =>
        target.getJobSchedulers(),
      );
      expect(schedulers.map(({ key }) => key)).toContain(declared.id);

      await inspect(declared.queue, (target) =>
        target.removeJobScheduler(declared.id),
      );
    });
  });
});
