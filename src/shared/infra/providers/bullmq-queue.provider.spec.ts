import type { ConfigService } from '@nestjs/config';
import type { Job, JobState, Queue } from 'bullmq';
import {
  buildJobId,
  buildJobName,
  buildJobPayload,
  queueScheduleFactory,
} from '@test/factories/shared/queue-job.factory.js';
import { faker } from '@test/support/faker.js';
import type { Environment } from '../../config/environment.config.js';
import {
  buildJobOptions,
  QUEUE_RETRY_POLICIES,
} from '../../config/queue.config.js';
import { QueueName } from '../../domain/dtos/providers/queue-job.dto.js';
import { QueueJobFailedException } from '../../domain/errors/queue-job-failed.exception.js';
import { QueueTimeoutException } from '../../domain/errors/queue-timeout.exception.js';
import {
  BullMqQueueProvider,
  type QueueRegistry,
} from './bullmq-queue.provider.js';

/** Prazo padrão de espera nas suítes: curto, para o estouro ser imediato. */
const WAIT_TIMEOUT_MS = 1_000;

interface FakeQueue {
  add: ReturnType<typeof vi.fn>;
  getJobState: ReturnType<typeof vi.fn>;
  getJob: ReturnType<typeof vi.fn>;
  upsertJobScheduler: ReturnType<typeof vi.fn>;
}

/**
 * Fila dublê com a parte do contrato do BullMQ que o provider usa. `states`
 * é consumida em ordem, uma por consulta, o que permite descrever um job que
 * só conclui depois de algumas voltas do polling.
 */
function fakeQueue(
  states: (JobState | 'unknown')[] = ['completed'],
  job: Partial<Job> = {},
): FakeQueue {
  const pending = [...states];

  return {
    add: vi.fn().mockResolvedValue({ id: buildJobId() }),
    getJobState: vi.fn(() => Promise.resolve(pending.shift() ?? 'waiting')),
    getJob: vi.fn().mockResolvedValue(job),
    upsertJobScheduler: vi.fn().mockResolvedValue({}),
  };
}

function createProvider(
  queues: Partial<Record<QueueName, FakeQueue>>,
): BullMqQueueProvider {
  const registry = new Map(
    Object.entries(queues) as unknown as [QueueName, Queue][],
  ) as QueueRegistry;
  const configService = {
    get: () => WAIT_TIMEOUT_MS,
  } as unknown as ConfigService<Environment, true>;

  return new BullMqQueueProvider(registry, configService);
}

describe('BullMqQueueProvider', () => {
  describe('publicação', () => {
    it('publica na fila pedida, com nome e carga do chamador', async () => {
      const queue = fakeQueue();
      const jobName = buildJobName();
      const payload = buildJobPayload();

      await createProvider({ [QueueName.ODS_SCORING]: queue }).enqueue(
        QueueName.ODS_SCORING,
        jobName,
        payload,
      );

      expect(queue.add).toHaveBeenCalledWith(
        jobName,
        payload,
        expect.objectContaining(buildJobOptions(QueueName.ODS_SCORING)),
      );
    });

    it('aplica a política de repetição da fila', async () => {
      const queue = fakeQueue();
      const { attempts, backoffMs } =
        QUEUE_RETRY_POLICIES[QueueName.EMAIL_DISPATCH];

      await createProvider({ [QueueName.EMAIL_DISPATCH]: queue }).enqueue(
        QueueName.EMAIL_DISPATCH,
        buildJobName(),
        buildJobPayload(),
      );

      expect(queue.add).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          attempts,
          backoff: { type: 'exponential', delay: backoffMs },
          // Job falho permanece registrado, para diagnóstico.
          removeOnFail: false,
        }),
      );
    });

    it('repassa identificador e atraso informados', async () => {
      const queue = fakeQueue();
      const jobId = faker.string.uuid();
      const delayMs = faker.number.int({ min: 1_000, max: 60_000 });

      await createProvider({ [QueueName.COMPANY_PROFILE]: queue }).enqueue(
        QueueName.COMPANY_PROFILE,
        buildJobName(),
        buildJobPayload(),
        { jobId, delayMs },
      );

      expect(queue.add).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ jobId, delay: delayMs }),
      );
    });

    it('recusa publicar em fila não registrada', async () => {
      const provider = createProvider({});

      await expect(
        provider.enqueue(QueueName.GHG_INVENTORY, buildJobName(), {}),
      ).rejects.toThrow(/não registrada/);
    });

    it('recusa um job publicado sem identificador', async () => {
      const queue = fakeQueue();
      queue.add.mockResolvedValue({ id: undefined });

      await expect(
        createProvider({ [QueueName.ODS_SCORING]: queue }).enqueue(
          QueueName.ODS_SCORING,
          buildJobName(),
          {},
        ),
      ).rejects.toThrow(/sem identificador/);
    });
  });

  describe('espera pela conclusão', () => {
    it('devolve o resultado do consumidor', async () => {
      const returnvalue = { score: faker.number.int({ max: 100 }) };
      const queue = fakeQueue(['completed'], { returnvalue });

      const result = await createProvider({
        [QueueName.ODS_SCORING]: queue,
      }).enqueueAndWait(QueueName.ODS_SCORING, buildJobName(), {});

      expect(result).toEqual(returnvalue);
    });

    it('insiste até o job sair do estado inicial', async () => {
      const returnvalue = buildJobPayload();
      const queue = fakeQueue(['waiting', 'active', 'completed'], {
        returnvalue,
      });

      const result = await createProvider({
        [QueueName.COMPANY_PROFILE]: queue,
      }).enqueueAndWait(QueueName.COMPANY_PROFILE, buildJobName(), {});

      expect(result).toEqual(returnvalue);
      expect(queue.getJobState).toHaveBeenCalledTimes(3);
    });

    it('lança QueueTimeoutException quando o prazo termina antes da conclusão', async () => {
      const queue = fakeQueue(['waiting']);
      const jobName = buildJobName();

      const attempt = createProvider({
        [QueueName.GHG_INVENTORY]: queue,
      }).enqueueAndWait(
        QueueName.GHG_INVENTORY,
        jobName,
        {},
        {
          timeoutMs: 0,
        },
      );

      await expect(attempt).rejects.toThrow(QueueTimeoutException);
      // O job segue na fila: o prazo é do chamador, não do processamento.
      await expect(attempt).rejects.toMatchObject({
        details: {
          queue: QueueName.GHG_INVENTORY,
          job: jobName,
          timeout_ms: 0,
        },
      });
    });

    it('lança QueueJobFailedException com o motivo registrado pelo consumidor', async () => {
      const failedReason = faker.lorem.sentence();
      const queue = fakeQueue(['failed'], { failedReason });

      const attempt = createProvider({
        [QueueName.ENVIRONMENTAL_EVIDENCES]: queue,
      }).enqueueAndWait(QueueName.ENVIRONMENTAL_EVIDENCES, buildJobName(), {});

      await expect(attempt).rejects.toThrow(QueueJobFailedException);
      await expect(attempt).rejects.toMatchObject({
        details: { reason: failedReason },
      });
    });

    it('registra a falha mesmo sem motivo informado', async () => {
      const queue = fakeQueue(['failed']);
      queue.getJob.mockResolvedValue(undefined);

      await expect(
        createProvider({
          [QueueName.EMAIL_DISPATCH]: queue,
        }).enqueueAndWait(QueueName.EMAIL_DISPATCH, buildJobName(), {}),
      ).rejects.toThrow(QueueJobFailedException);
    });

    it('respeita o prazo informado na chamada, acima do configurado', async () => {
      const queue = fakeQueue(['waiting', 'completed'], { returnvalue: null });

      const result = await createProvider({
        [QueueName.ODS_SCORING]: queue,
      }).enqueueAndWait(
        QueueName.ODS_SCORING,
        buildJobName(),
        {},
        {
          timeoutMs: WAIT_TIMEOUT_MS * 2,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe('jobs repetíveis', () => {
    it('registra o agendamento pelo identificador, com o padrão cron', async () => {
      const queue = fakeQueue();
      const schedule = queueScheduleFactory.build({
        queue: QueueName.ENVIRONMENTAL_EVIDENCES,
      });

      await createProvider({
        [QueueName.ENVIRONMENTAL_EVIDENCES]: queue,
      }).schedule(schedule);

      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        schedule.id,
        { pattern: schedule.cron },
        expect.objectContaining({ name: schedule.jobName }),
      );
    });

    it('registrar o mesmo agendamento duas vezes não cria um segundo', async () => {
      const queue = fakeQueue();
      const schedule = queueScheduleFactory.build({
        queue: QueueName.ENVIRONMENTAL_EVIDENCES,
      });
      const provider = createProvider({
        [QueueName.ENVIRONMENTAL_EVIDENCES]: queue,
      });

      await provider.schedule(schedule);
      await provider.schedule(schedule);

      // A idempotência é do `upsert` pelo id: as duas chamadas são idênticas.
      expect(queue.upsertJobScheduler.mock.calls[0]).toEqual(
        queue.upsertJobScheduler.mock.calls[1],
      );
    });
  });
});
