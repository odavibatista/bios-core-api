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

    it('a política própria de um job substitui a da fila', () => {
      const retry = {
        attempts: QUEUE_RETRY_POLICIES[QueueName.COMPANY_PROFILE].attempts + 4,
        backoffMs: 777_000,
      };

      expect(buildJobOptions(QueueName.COMPANY_PROFILE, retry)).toMatchObject({
        attempts: retry.attempts,
        backoff: { type: 'exponential', delay: retry.backoffMs },
        removeOnFail: false,
      });
    });

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

    it('declara o lote diário do IBAMA na fila própria do IBAMA', () => {
      const daily = QUEUE_SCHEDULES.find(({ id }) => id.includes('ibama'));

      expect(daily).toMatchObject({
        queue: QueueName.IBAMA_INGESTION,
        cron: expect.stringMatching(/^\d+ \d+ \* \* \*$/),
      });
    });

    it('o lote diário do IBAMA espera minutos entre as tentativas, e a fila continua curta', () => {
      const daily = QUEUE_SCHEDULES.find(({ id }) => id.includes('ibama'));
      const queuePolicy = QUEUE_RETRY_POLICIES[QueueName.IBAMA_INGESTION];

      expect(daily?.retry).toEqual({ attempts: 5, backoffMs: 300_000 });
      // Os jobs por CNPJ da mesma fila seguem errando rápido.
      expect(queuePolicy.backoffMs).toBeLessThan(60_000);
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
        // Exigência do BullMQ para as conexões bloqueantes dos consumidores,
        // e esta API hospeda um: o envio de e-mails. Quem protege o lado
        // produtor de esperar sem fim é o orçamento de publicação.
        maxRetriesPerRequest: null,
      });
    });
  });
});
