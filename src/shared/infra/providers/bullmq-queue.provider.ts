import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { Environment } from '../../config/environment.config.js';
import {
  buildJobOptions,
  QUEUE_WAIT_POLL_INTERVAL_MS,
} from '../../config/queue.config.js';
import type {
  EnqueueAndWaitOptions,
  EnqueueOptions,
  QueueName,
  QueueSchedule,
} from '../../domain/dtos/providers/queue-job.dto.js';
import { QueueJobFailedException } from '../../domain/errors/queue-job-failed.exception.js';
import { QueueTimeoutException } from '../../domain/errors/queue-timeout.exception.js';
import { QueueProvider } from '../../domain/providers/queue.provider.js';

/** Token do mapa de filas registradas, montado pelo `QueueModule`. */
export const QUEUE_REGISTRY = Symbol('QUEUE_REGISTRY');

/** Filas registradas, indexadas pelo nome. */
export type QueueRegistry = ReadonlyMap<QueueName, Queue>;

/**
 * Produção de jobs sobre BullMQ e Redis (NFCO01, NFPD02).
 *
 * Cada fila declarada é registrada pelo módulo e chega aqui pelo mapa de filas;
 * os consumidores vivem nos serviços de ingestão.
 *
 * A espera pela conclusão consulta o estado do job em intervalos curtos, em vez
 * de usar `QueueEvents`. O motivo é a exigência de a API subir com o Redis fora
 * do ar: o `QueueEvents` abre uma conexão bloqueante assim que é construído e,
 * sem Redis, derruba o processo com uma rejeição que não passa pelo evento de
 * erro. O polling custa um comando por intervalo e falha de forma tratável.
 */
@Injectable()
export class BullMqQueueProvider extends QueueProvider {
  private readonly waitTimeoutMs: number;

  constructor(
    @Inject(QUEUE_REGISTRY) private readonly queues: QueueRegistry,
    configService: ConfigService<Environment, true>,
  ) {
    super();
    this.waitTimeoutMs = configService.get('QUEUE_WAIT_TIMEOUT_MS', {
      infer: true,
    });
  }

  override async enqueue<P>(
    queue: QueueName,
    jobName: string,
    payload: P,
    options: EnqueueOptions = {},
  ): Promise<void> {
    await this.publish(queue, jobName, payload, options);
  }

  override async enqueueAndWait<P, R>(
    queue: QueueName,
    jobName: string,
    payload: P,
    options: EnqueueAndWaitOptions = {},
  ): Promise<R> {
    const timeoutMs = options.timeoutMs ?? this.waitTimeoutMs;
    const target = this.queueOf(queue);
    const jobId = await this.publish(queue, jobName, payload, options);
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const state = await target.getJobState(jobId);

      if (state === 'completed' || state === 'failed') {
        const job = await target.getJob(jobId);

        if (state === 'failed') {
          throw new QueueJobFailedException(
            queue,
            jobName,
            job?.failedReason ?? 'motivo não registrado pelo consumidor',
          );
        }

        return job?.returnvalue as R;
      }

      const remaining = deadline - Date.now();

      if (remaining <= 0) {
        throw new QueueTimeoutException(queue, jobName, timeoutMs);
      }

      await sleep(Math.min(QUEUE_WAIT_POLL_INTERVAL_MS, remaining));
    }
  }

  override async schedule({
    queue,
    id,
    jobName,
    cron,
  }: QueueSchedule): Promise<void> {
    await this.queueOf(queue).upsertJobScheduler(
      id,
      { pattern: cron },
      { name: jobName, opts: buildJobOptions(queue) },
    );
  }

  private async publish<P>(
    queue: QueueName,
    jobName: string,
    payload: P,
    { jobId, delayMs }: EnqueueOptions,
  ): Promise<string> {
    const job = await this.queueOf(queue).add(jobName, payload, {
      ...buildJobOptions(queue),
      jobId,
      delay: delayMs,
    });

    if (!job.id) {
      throw new Error(`Job publicado em "${queue}" sem identificador.`);
    }

    return job.id;
  }

  private queueOf(name: QueueName): Queue {
    const queue = this.queues.get(name);

    if (!queue) {
      throw new Error(`Fila "${name}" não registrada no QueueModule.`);
    }

    return queue;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
