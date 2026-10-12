import { Global, Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { Environment } from '../../config/environment.config.js';
import { buildQueueConnection } from '../../config/queue.config.js';
import {
  QUEUE_NAMES,
  type QueueName,
} from '../../domain/dtos/providers/queue-job.dto.js';
import { QueueProvider } from '../../domain/providers/queue.provider.js';
import { RedisHealthProvider } from '../../domain/providers/redis-health.provider.js';
import {
  BullMqQueueProvider,
  QUEUE_REGISTRY,
  type QueueRegistry,
} from '../providers/bullmq-queue.provider.js';
import { QueueSchedulesInitializer } from '../queue/queue-schedules.initializer.js';
import { REDIS_CLIENT, RedisService } from '../redis/redis.service.js';

/**
 * Módulo global de mensageria (NFCO01, NFPD02).
 *
 * Toda a comunicação entre o core e os serviços de ingestão passa por aqui: o
 * core publica jobs e, quando a consulta do usuário exige resposta imediata,
 * aguarda a conclusão com prazo. Não há consumidor nesta aplicação — cada fila
 * é processada pelo serviço dono do fluxo.
 *
 * Global porque qualquer módulo de negócio pode publicar, sempre com a mesma
 * conexão e as mesmas políticas de repetição.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Environment, true>) => ({
        connection: buildQueueConnection(configService),
      }),
    }),
    BullModule.registerQueue(...QUEUE_NAMES.map((name) => ({ name }))),
  ],
  providers: [
    /* Conexão de apoio: health check do Redis.
       `lazyConnect` deixa a aplicação subir com o Redis fora do ar — o health
       check reporta a falha, em vez de o boot ser impedido. */
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Environment, true>) =>
        new Redis(configService.get('REDIS_URL', { infer: true }), {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        }),
    },
    RedisService,
    { provide: RedisHealthProvider, useExisting: RedisService },

    /* Filas registradas, reunidas em um único mapa para o provider */
    {
      provide: QUEUE_REGISTRY,
      inject: QUEUE_NAMES.map((name) => getQueueToken(name)),
      useFactory: (...queues: Queue[]): QueueRegistry =>
        new Map(
          QUEUE_NAMES.map((name, position): [QueueName, Queue] => [
            name,
            queues[position],
          ]),
        ),
    },

    /* Providers */
    BullMqQueueProvider,
    { provide: QueueProvider, useExisting: BullMqQueueProvider },

    /* Inicialização */
    QueueSchedulesInitializer,
  ],
  exports: [QueueProvider, RedisHealthProvider],
})
export class QueueModule {}
