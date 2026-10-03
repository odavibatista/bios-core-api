import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment.config.js';
import { DATABASE_HEALTH_TIMEOUT_MS, PrismaService } from './prisma.service.js';

describe('PrismaService', () => {
  const configService = {
    get: () => 'mongodb://localhost:27017/bios_test?directConnection=true',
  } as unknown as ConfigService<Environment, true>;

  let service: PrismaService;

  beforeEach(() => {
    service = new PrismaService(configService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isAvailable', () => {
    it('retorna verdadeiro quando o banco responde ao ping', async () => {
      const ping = vi
        .spyOn(service, '$runCommandRaw')
        .mockResolvedValue({ ok: 1 });

      await expect(service.isAvailable()).resolves.toBe(true);
      expect(ping).toHaveBeenCalledWith({ ping: 1 });
    });

    it('retorna falso quando o ping falha', async () => {
      vi.spyOn(service, '$runCommandRaw').mockRejectedValue(
        new Error('offline'),
      );

      await expect(service.isAvailable()).resolves.toBe(false);
    });

    it('retorna falso quando o banco não responde dentro do tempo limite', async () => {
      vi.useFakeTimers();
      vi.spyOn(service, '$runCommandRaw').mockReturnValue(
        new Promise(() => undefined) as ReturnType<
          PrismaService['$runCommandRaw']
        >,
      );

      const availability = service.isAvailable();
      await vi.advanceTimersByTimeAsync(DATABASE_HEALTH_TIMEOUT_MS);

      await expect(availability).resolves.toBe(false);
    });
  });

  it('encerra a conexão ao destruir o módulo', async () => {
    const disconnect = vi.spyOn(service, '$disconnect').mockResolvedValue();

    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledOnce();
  });
});
