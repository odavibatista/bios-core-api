import { Test } from '@nestjs/testing';
import { faker } from '@test/support/faker.js';
import {
  REDIS_CLIENT,
  REDIS_HEALTH_TIMEOUT_MS,
  RedisService,
} from './redis.service.js';

describe('RedisService', () => {
  const client = {
    ping: vi.fn<() => Promise<string>>(),
    on: vi.fn(),
    disconnect: vi.fn(),
  };
  let service: RedisService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [RedisService, { provide: REDIS_CLIENT, useValue: client }],
    }).compile();

    service = moduleRef.get(RedisService);
  });

  describe('disponibilidade', () => {
    it('reporta disponível quando o Redis responde PONG', async () => {
      client.ping.mockResolvedValue('PONG');

      await expect(service.isAvailable()).resolves.toBe(true);
    });

    it('reporta indisponível quando o comando falha', async () => {
      client.ping.mockRejectedValue(new Error(faker.lorem.sentence()));

      await expect(service.isAvailable()).resolves.toBe(false);
    });

    it('reporta indisponível quando a resposta não é PONG', async () => {
      client.ping.mockResolvedValue(faker.lorem.word());

      await expect(service.isAvailable()).resolves.toBe(false);
    });

    it('reporta indisponível quando o Redis não responde no tempo limite', async () => {
      vi.useFakeTimers();
      client.ping.mockReturnValue(new Promise(() => undefined));

      const availability = service.isAvailable();
      await vi.advanceTimersByTimeAsync(REDIS_HEALTH_TIMEOUT_MS);

      await expect(availability).resolves.toBe(false);
      vi.useRealTimers();
    });
  });

  it('trata o evento de erro do cliente, que sem ouvinte derrubaria o processo', () => {
    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));

    const [[, onError]] = client.on.mock.calls as [
      [string, (e: Error) => void],
    ];

    expect(() => onError(new Error(faker.lorem.sentence()))).not.toThrow();
  });

  it('encerra a conexão no desligamento da aplicação', () => {
    service.onApplicationShutdown();

    expect(client.disconnect).toHaveBeenCalled();
  });
});
