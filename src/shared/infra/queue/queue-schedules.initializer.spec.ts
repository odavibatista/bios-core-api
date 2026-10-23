import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { faker } from '@test/support/faker.js';
import {
  QUEUE_RETIRED_SCHEDULES,
  QUEUE_SCHEDULES,
} from '../../config/queue.config.js';
import { QueueProvider } from '../../domain/providers/queue.provider.js';
import { RedisHealthProvider } from '../../domain/providers/redis-health.provider.js';
import { QueueSchedulesInitializer } from './queue-schedules.initializer.js';

describe('QueueSchedulesInitializer', () => {
  const redisHealthProvider = { isAvailable: vi.fn<() => Promise<boolean>>() };
  const queueProvider = {
    schedule: vi.fn<() => Promise<void>>(),
    unschedule: vi.fn<() => Promise<void>>(),
  };
  let syncOnBoot: boolean;
  let initializer: QueueSchedulesInitializer;

  beforeEach(async () => {
    syncOnBoot = true;
    redisHealthProvider.isAvailable.mockResolvedValue(true);
    queueProvider.schedule.mockResolvedValue();
    queueProvider.unschedule.mockResolvedValue();

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

  it('remove os agendamentos que mudaram de fila antes de registrar os novos', async () => {
    await initializer.synchronize();

    expect(queueProvider.unschedule).toHaveBeenCalledTimes(
      QUEUE_RETIRED_SCHEDULES.length,
    );
    for (const { queue, id } of QUEUE_RETIRED_SCHEDULES)
      expect(queueProvider.unschedule).toHaveBeenCalledWith(queue, id);
  });

  it('falha ao remover agendamento antigo não impede o registro dos novos', async () => {
    queueProvider.unschedule.mockRejectedValue(new Error('redis'));

    await expect(initializer.synchronize()).resolves.toBeUndefined();
    expect(queueProvider.schedule).toHaveBeenCalledTimes(
      QUEUE_SCHEDULES.length,
    );
  });

  it('não registra nada com o Redis indisponível', async () => {
    redisHealthProvider.isAvailable.mockResolvedValue(false);

    await initializer.synchronize();

    expect(queueProvider.schedule).not.toHaveBeenCalled();
    expect(queueProvider.unschedule).not.toHaveBeenCalled();
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
