import type { ConfigService } from '@nestjs/config';
import { faker } from '@test/support/faker.js';
import {
  QUEUE_NAMES,
  QueueName,
} from '../domain/dtos/providers/queue-job.dto.js';
import type { Environment } from './environment.config.js';
import {
  buildJobOptions,
  buildQueueConnection,
  QUEUE_RETRY_POLICIES,
  QUEUE_SCHEDULES,
} from './queue.config.js';

describe('configuração de filas', () => {
  describe('políticas de repetição', () => {
    it('declara uma política para cada fila', () => {
      expect(Object.keys(QUEUE_RETRY_POLICIES).sort()).toEqual(
        [...QUEUE_NAMES].sort(),
      );
    });

    it.each(QUEUE_NAMES)(
      'traduz a política de %s em opções de job',
      (queue) => {
        const { attempts, backoffMs } = QUEUE_RETRY_POLICIES[queue];

        expect(buildJobOptions(queue)).toMatchObject({
          attempts,
          backoff: { type: 'exponential', delay: backoffMs },
          // Job falho permanece registrado: é o que permite diagnosticar a falha
          // e distinguir, na espera, falha de prazo estourado.
          removeOnFail: false,
        });
      },
    );

    it.each(QUEUE_NAMES)(
      '%s tenta mais de uma vez antes de desistir',
      (queue) => {
        expect(QUEUE_RETRY_POLICIES[queue].attempts).toBeGreaterThan(1);
        expect(QUEUE_RETRY_POLICIES[queue].backoffMs).toBeGreaterThan(0);
      },
    );
  });

  describe('jobs repetíveis', () => {
    it('agenda em filas declaradas', () => {
      for (const { queue } of QUEUE_SCHEDULES) {
        expect(QUEUE_NAMES).toContain(queue);
      }
    });

    it('usa identificadores únicos, de que depende a idempotência', () => {
      const identifiers = QUEUE_SCHEDULES.map(({ id }) => id);

      expect(new Set(identifiers).size).toBe(identifiers.length);
    });

    it('declara o lote diário do IBAMA na fila de evidências ambientais', () => {
      const daily = QUEUE_SCHEDULES.find(({ id }) => id.includes('ibama'));

      expect(daily).toMatchObject({
        queue: QueueName.ENVIRONMENTAL_EVIDENCES,
        cron: expect.stringMatching(/^\d+ \d+ \* \* \*$/),
      });
    });
  });

  describe('conexão', () => {
    it('usa a URL do ambiente e sobe sem conectar', () => {
      const url = `redis://${faker.internet.domainName()}:6379/0`;
      const configService = {
        get: () => url,
      } as unknown as ConfigService<Environment, true>;

      expect(buildQueueConnection(configService)).toEqual({
        url,
        // A aplicação sobe com o Redis fora do ar; o health check reporta.
        lazyConnect: true,
        // Conexão produtora: o comando falha rápido em vez de pendurar a
        // requisição do usuário.
        maxRetriesPerRequest: 1,
      });
    });
  });
});
