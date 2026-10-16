import { Global, Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { Environment } from '../../config/environment.config.js';
import { buildQueueConnection } from '../../config/queue.config.js';
import {
  QUEUE_NAMES,
  type QueueName,
} from '../../domain/dtos/providers/queue-job.dto.js';
import { QueueProvider } from '../../domain/providers/queue.provider.js';
import {
  BullMqQueueProvider,
  QUEUE_REGISTRY,
  type QueueRegistry,
} from '../providers/bullmq-queue.provider.js';
import { QueueSchedulesInitializer } from '../queue/queue-schedules.initializer.js';
import { RedisModule } from './redis.module.js';

/**
 * Módulo global de mensageria (NFCO01, NFPD02).
 *
 * Toda a comunicação entre quem pede e quem processa passa por aqui: o
 * core publica jobs e, quando a consulta do usuário exige resposta imediata,
 * aguarda a conclusão com prazo. Os consumidores ficam nos módulos donos do fluxo
 * (`@Processor`), e não aqui.
 *
 * A conexão de apoio do Redis (health check e cache) fica no `RedisModule`: o
 * BullMQ administra as próprias conexões a partir das opções de
 * `buildQueueConnection`, inclusive bloqueantes.
 *
 * Global porque qualquer módulo de negócio pode publicar, sempre com a mesma
 * conexão e as mesmas políticas de repetição.
 */
@Global()
@Module({
  imports: [
    // O registro dos agendamentos depende do health check do Redis para saber
    // se vale tentar.
    RedisModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Environment, true>) => ({
        connection: buildQueueConnection(configService),
      }),
    }),
    BullModule.registerQueue(...QUEUE_NAMES.map((name) => ({ name }))),
  ],
  providers: [
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
  exports: [QueueProvider],
})
export class QueueModule {}
