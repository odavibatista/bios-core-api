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
  let sectorCron: string;
  let initializer: QueueSchedulesInitializer;

  /** O agendamento como deve ser registrado: com o cron da variável, quando a declara. */
  const registered = (schedule: (typeof QUEUE_SCHEDULES)[number]) =>
    schedule.cronSetting ? { ...schedule, cron: sectorCron } : schedule;

  beforeEach(async () => {
    syncOnBoot = true;
    sectorCron = '15 2 * * *';
    redisHealthProvider.isAvailable.mockResolvedValue(true);
    queueProvider.schedule.mockResolvedValue();
    queueProvider.unschedule.mockResolvedValue();

    const moduleRef = await Test.createTestingModule({
      providers: [
        QueueSchedulesInitializer,
        { provide: RedisHealthProvider, useValue: redisHealthProvider },
        { provide: QueueProvider, useValue: queueProvider },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'SECTOR_SNAPSHOT_CRON' ? sectorCron : syncOnBoot,
          },
        },
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
      expect(queueProvider.schedule).toHaveBeenCalledWith(registered(schedule));
    }
  });

  it('o cron da variável de ambiente substitui o padrão do agendamento que a declara (#89)', async () => {
    await initializer.synchronize();

    const sector = QUEUE_SCHEDULES.find(
      ({ id }) => id === 'sector-score-snapshots',
    );
    expect(sector?.cronSetting).toBe('SECTOR_SNAPSHOT_CRON');
    expect(queueProvider.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sector-score-snapshots',
        cron: '15 2 * * *',
      }),
    );
    expect(queueProvider.schedule).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sector-score-snapshots',
        cron: '0 6 * * *',
      }),
    );
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
