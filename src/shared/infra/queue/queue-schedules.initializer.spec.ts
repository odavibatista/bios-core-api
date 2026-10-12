import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { faker } from '@test/support/faker.js';
import { QUEUE_SCHEDULES } from '../../config/queue.config.js';
import { QueueProvider } from '../../domain/providers/queue.provider.js';
import { RedisHealthProvider } from '../../domain/providers/redis-health.provider.js';
import { QueueSchedulesInitializer } from './queue-schedules.initializer.js';

describe('QueueSchedulesInitializer', () => {
  const redisHealthProvider = { isAvailable: vi.fn<() => Promise<boolean>>() };
  const queueProvider = { schedule: vi.fn<() => Promise<void>>() };
  let syncOnBoot: boolean;
  let initializer: QueueSchedulesInitializer;

  beforeEach(async () => {
    syncOnBoot = true;
    redisHealthProvider.isAvailable.mockResolvedValue(true);
    queueProvider.schedule.mockResolvedValue();

    const moduleRef = await Test.createTestingModule({
      providers: [
        QueueSchedulesInitializer,
        { provide: RedisHealthProvider, useValue: redisHealthProvider },
        { provide: QueueProvider, useValue: queueProvider },
        { provide: ConfigService, useValue: { get: () => syncOnBoot } },
      ],
    }).compile();

    initializer = moduleRef.get(QueueSchedulesInitializer);
  });

  it('registra todos os agendamentos declarados', async () => {
    await initializer.synchronize();

    expect(queueProvider.schedule).toHaveBeenCalledTimes(
      QUEUE_SCHEDULES.length,
    );
    for (const schedule of QUEUE_SCHEDULES) {
      expect(queueProvider.schedule).toHaveBeenCalledWith(schedule);
    }
  });

  it('não registra nada com o Redis indisponível', async () => {
    redisHealthProvider.isAvailable.mockResolvedValue(false);

    await initializer.synchronize();

    expect(queueProvider.schedule).not.toHaveBeenCalled();
  });

  it('segue com os demais agendamentos quando um falha', async () => {
    queueProvider.schedule.mockRejectedValue(new Error(faker.lorem.sentence()));

    // A falha é registrada em log, nunca propagada: o boot não para por isso.
    await expect(initializer.synchronize()).resolves.toBeUndefined();
    expect(queueProvider.schedule).toHaveBeenCalledTimes(
      QUEUE_SCHEDULES.length,
    );
  });

  describe('inicialização da aplicação', () => {
    it('dispara o registro quando habilitado', async () => {
      initializer.onApplicationBootstrap();
      await vi.waitFor(() =>
        expect(queueProvider.schedule).toHaveBeenCalledTimes(
          QUEUE_SCHEDULES.length,
        ),
      );

      // Roda em segundo plano: o boot não espera o Redis responder.
      expect(redisHealthProvider.isAvailable).toHaveBeenCalled();
    });

    it('não dispara o registro quando desabilitado', () => {
      syncOnBoot = false;

      initializer.onApplicationBootstrap();

      expect(redisHealthProvider.isAvailable).not.toHaveBeenCalled();
    });
  });
});
