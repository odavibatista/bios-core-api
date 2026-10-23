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
  QUEUE_PUBLISH_BUDGET_MS,
  QUEUE_RETRY_POLICIES,
} from '../../config/queue.config.js';
import { QueueName } from '../../domain/dtos/providers/queue-job.dto.js';
import { DependencyUnavailableException } from '../../domain/errors/dependency-unavailable.exception.js';
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
  removeJobScheduler: ReturnType<typeof vi.fn>;
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
    removeJobScheduler: vi.fn().mockResolvedValue(true),
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

    describe('orçamento de publicação', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      /**
       * Publica capturando o desfecho em vez de propagá-lo.
       *
       * A rejeição acontece durante o avanço dos temporizadores, e uma
       * asserção anexada só depois a encontraria órfã — o que o Vitest
       * reporta como erro não tratado, mesmo com o teste passando.
       */
      function publishCapturing(queue: FakeQueue, name: QueueName) {
        return createProvider({ [name]: queue })
          .enqueue(name, buildJobName(), {})
          .then(
            () => undefined,
            (error: unknown) => error,
          );
      }

      it('reporta o Redis indisponível quando a publicação não responde', async () => {
        const queue = fakeQueue();
        // O cliente guarda o comando enquanto tenta reconectar; a publicação
        // não pode esperar junto com a requisição que a originou.
        queue.add.mockReturnValue(new Promise(() => undefined));

        const publishing = publishCapturing(queue, QueueName.COMPANY_PROFILE);
        await vi.advanceTimersByTimeAsync(QUEUE_PUBLISH_BUDGET_MS);

        const failure = await publishing;
        expect(failure).toBeInstanceOf(DependencyUnavailableException);
        expect(failure).toMatchObject({ details: { dependency: 'redis' } });
      });

      it('trata a falha que chega depois do orçamento vencido', async () => {
        const queue = fakeQueue();
        queue.add.mockReturnValue(
          new Promise((_resolve, reject) =>
            setTimeout(
              () => reject(new Error('conexão perdida')),
              QUEUE_PUBLISH_BUDGET_MS + 10,
            ),
          ),
        );

        const publishing = publishCapturing(queue, QueueName.GHG_INVENTORY);
        await vi.advanceTimersByTimeAsync(QUEUE_PUBLISH_BUDGET_MS);
        expect(await publishing).toBeInstanceOf(DependencyUnavailableException);

        // A rejeição tardia da publicação já tem quem a trate: sem isso,
        // ficaria órfã e reprovaria este próprio teste.
        await vi.advanceTimersByTimeAsync(20);
      });

      it('não reclama da publicação que responde dentro do orçamento', async () => {
        const queue = fakeQueue();
        const id = buildJobId();
        queue.add.mockReturnValue(
          new Promise((resolve) => setTimeout(() => resolve({ id }), 1)),
        );

        const publishing = createProvider({
          [QueueName.EMAIL_DISPATCH]: queue,
        }).enqueue(QueueName.EMAIL_DISPATCH, buildJobName(), {});
        await vi.advanceTimersByTimeAsync(1);

        await expect(publishing).resolves.toBeUndefined();
      });
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

  describe('coalescência exata por jobId (#80)', () => {
    /** Fila com estado por `jobId` e jobs que sabem se foram removidos. */
    function queueWith(states: Record<string, JobState | 'unknown'>) {
      const removed: string[] = [];
      const queue = {
        add: vi.fn().mockResolvedValue({ id: 'publicado' }),
        getJobState: vi.fn((id: string) =>
          Promise.resolve(states[id] ?? 'unknown'),
        ),
        getJob: vi.fn((id: string) =>
          Promise.resolve({
            remove: () => {
              removed.push(id);
              states[id] = 'unknown';

              return Promise.resolve();
            },
          }),
        ),
        upsertJobScheduler: vi.fn(),
        removeJobScheduler: vi.fn(),
      };

      return { queue, removed };
    }
    const publish = (
      queue: ReturnType<typeof queueWith>['queue'],
      jobId: string,
    ) =>
      createProvider({ [QueueName.ODS_SCORING]: queue }).enqueue(
        QueueName.ODS_SCORING,
        buildJobName(),
        buildJobPayload(),
        { jobId, coalesce: true },
      );
    const publishedId = (queue: ReturnType<typeof queueWith>['queue']) =>
      (queue.add.mock.calls[0] as [string, unknown, { jobId: string }])[2]
        .jobId;

    it('sem job anterior, publica com o próprio jobId', async () => {
      const { queue, removed } = queueWith({});

      await publish(queue, 'scores-1');

      expect(publishedId(queue)).toBe('scores-1');
      expect(removed).toEqual([]);
    });

    it.each(['waiting', 'delayed', 'prioritized'] as const)(
      'job %s: publica com o mesmo jobId, e o BullMQ funde o pedido a ele',
      async (state) => {
        const { queue, removed } = queueWith({ 'scores-1': state });

        await publish(queue, 'scores-1');

        expect(publishedId(queue)).toBe('scores-1');
        expect(removed).toEqual([]);
      },
    );

    it.each(['completed', 'failed'] as const)(
      'job %s: remove o registro e publica um job novo (o resultado velho não vale)',
      async (state) => {
        const { queue, removed } = queueWith({ 'scores-1': state });

        await publish(queue, 'scores-1');

        expect(removed).toEqual(['scores-1']);
        expect(publishedId(queue)).toBe('scores-1');
      },
    );

    it('job ativo: publica um único acompanhamento, para não perder o que chegou depois da leitura', async () => {
      const { queue, removed } = queueWith({ 'scores-1': 'active' });

      await publish(queue, 'scores-1');

      expect(publishedId(queue)).toBe('scores-1~next');
      expect(removed).toEqual([]);
    });

    it('job ativo com acompanhamento já pendente: funde-se a ele', async () => {
      const { queue, removed } = queueWith({
        'scores-1': 'active',
        'scores-1~next': 'waiting',
      });

      await publish(queue, 'scores-1');

      expect(publishedId(queue)).toBe('scores-1~next');
      expect(removed).toEqual([]);
    });

    it('acompanhamento anterior já concluído é removido antes de publicar outro', async () => {
      const { queue, removed } = queueWith({
        'scores-1': 'active',
        'scores-1~next': 'completed',
      });

      await publish(queue, 'scores-1');

      expect(removed).toEqual(['scores-1~next']);
      expect(publishedId(queue)).toBe('scores-1~next');
    });

    it('sem coalesce, não consulta o estado nem remove nada', async () => {
      const { queue, removed } = queueWith({ 'scores-1': 'completed' });

      await createProvider({ [QueueName.ODS_SCORING]: queue }).enqueue(
        QueueName.ODS_SCORING,
        buildJobName(),
        buildJobPayload(),
        { jobId: 'scores-1' },
      );

      expect(queue.getJobState).not.toHaveBeenCalled();
      expect(removed).toEqual([]);
      expect(publishedId(queue)).toBe('scores-1');
    });

    it('enqueueAndWait espera o job que de fato foi publicado', async () => {
      const { queue } = queueWith({ 'scores-1': 'active' });
      let published = false;
      queue.add.mockImplementation(() => {
        published = true;

        return Promise.resolve({ id: 'scores-1~next' });
      });
      queue.getJobState.mockImplementation((id: string) =>
        Promise.resolve(
          id === 'scores-1' ? 'active' : published ? 'completed' : 'unknown',
        ),
      );
      queue.getJob.mockImplementation(() =>
        Promise.resolve({ returnvalue: { ok: true } } as never),
      );

      const result = await createProvider({
        [QueueName.ODS_SCORING]: queue,
      }).enqueueAndWait(
        QueueName.ODS_SCORING,
        buildJobName(),
        buildJobPayload(),
        {
          jobId: 'scores-1',
          coalesce: true,
        },
      );

      expect(result).toEqual({ ok: true });
      expect(queue.getJob).toHaveBeenCalledWith('scores-1~next');
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

    it('remove um agendamento antigo pelo identificador', async () => {
      const queue = fakeQueue();

      await createProvider({
        [QueueName.ENVIRONMENTAL_EVIDENCES]: queue,
      }).unschedule(QueueName.ENVIRONMENTAL_EVIDENCES, 'ibama-daily-ingestion');

      expect(queue.removeJobScheduler).toHaveBeenCalledWith(
        'ibama-daily-ingestion',
      );
    });

    it('sem política própria, o job agendado herda a da fila', async () => {
      const queue = fakeQueue();
      const schedule = queueScheduleFactory.build({
        queue: QueueName.ENVIRONMENTAL_EVIDENCES,
        retry: undefined,
      });

      await createProvider({
        [QueueName.ENVIRONMENTAL_EVIDENCES]: queue,
      }).schedule(schedule);

      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        schedule.id,
        { pattern: schedule.cron },
        {
          name: schedule.jobName,
          opts: buildJobOptions(QueueName.ENVIRONMENTAL_EVIDENCES),
        },
      );
    });

    it('com política própria, o job agendado repete como ela manda, e não como a fila', async () => {
      const queue = fakeQueue();
      const retry = {
        attempts:
          QUEUE_RETRY_POLICIES[QueueName.ENVIRONMENTAL_EVIDENCES].attempts + 2,
        backoffMs: 300_000,
      };
      const schedule = queueScheduleFactory.build({
        queue: QueueName.ENVIRONMENTAL_EVIDENCES,
        retry,
      });

      await createProvider({
        [QueueName.ENVIRONMENTAL_EVIDENCES]: queue,
      }).schedule(schedule);

      const [, , template] = queue.upsertJobScheduler.mock.calls[0] as [
        string,
        unknown,
        { opts: { attempts: number; backoff: unknown } },
      ];
      expect(template.opts.attempts).toBe(retry.attempts);
      expect(template.opts.backoff).toEqual({
        type: 'exponential',
        delay: retry.backoffMs,
      });
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
