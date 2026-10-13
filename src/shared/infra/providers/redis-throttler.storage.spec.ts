import { Test } from '@nestjs/testing';
import { faker } from '@test/support/faker.js';
import { THROTTLER_KEY_PREFIX } from '../../config/throttler.config.js';
import { REDIS_CLIENT } from '../redis/redis.service.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

/** Janela e limite das suítes, em milissegundos e requisições. */
const TTL_MS = 60_000;
const LIMIT = 10;
const BLOCK_MS = 30_000;

describe('RedisThrottlerStorage', () => {
  const exec = vi.fn<() => Promise<[Error | null, unknown][] | null>>();
  const client = {
    pttl: vi.fn<() => Promise<number>>(),
    set: vi.fn<() => Promise<string>>(),
    multi: vi.fn(() => ({
      incr: vi.fn().mockReturnThis(),
      pexpire: vi.fn().mockReturnThis(),
      pttl: vi.fn().mockReturnThis(),
      exec,
    })),
  };
  let storage: RedisThrottlerStorage;

  /** Resposta da transação: total de requisições e o que resta da janela. */
  function counted(totalHits: number, remainingMs = TTL_MS): void {
    exec.mockResolvedValue([
      [null, totalHits],
      [null, 1],
      [null, remainingMs],
    ]);
  }

  function increment(): Promise<unknown> {
    return storage.increment(
      faker.string.alphanumeric(16),
      TTL_MS,
      LIMIT,
      BLOCK_MS,
      'default',
    );
  }

  beforeEach(async () => {
    client.pttl.mockResolvedValue(-2);
    client.set.mockResolvedValue('OK');
    counted(1);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RedisThrottlerStorage,
        { provide: REDIS_CLIENT, useValue: client },
      ],
    }).compile();

    storage = moduleRef.get(RedisThrottlerStorage);
  });

  describe('dentro do limite', () => {
    it('conta a requisição e informa o que resta da janela, em segundos', async () => {
      counted(3, 45_000);

      await expect(increment()).resolves.toEqual({
        totalHits: 3,
        timeToExpire: 45,
        isBlocked: false,
        timeToBlockExpire: 0,
      });
    });

    it('usa uma chave por limite nomeado, para os contadores não se misturarem', async () => {
      const key = faker.string.alphanumeric(16);
      const incr = vi.fn().mockReturnThis();
      client.multi.mockReturnValue({
        incr,
        pexpire: vi.fn().mockReturnThis(),
        pttl: vi.fn().mockReturnThis(),
        exec,
      });

      await storage.increment(key, TTL_MS, LIMIT, BLOCK_MS, 'publicApi');

      expect(incr).toHaveBeenCalledWith(
        `${THROTTLER_KEY_PREFIX}:publicApi:${key}`,
      );
    });
  });

  describe('limite excedido', () => {
    it('bloqueia e informa o prazo de liberação', async () => {
      counted(LIMIT + 1);

      await expect(increment()).resolves.toMatchObject({
        totalHits: LIMIT + 1,
        isBlocked: true,
        timeToBlockExpire: BLOCK_MS / 1_000,
      });
      expect(client.set).toHaveBeenCalledWith(
        expect.stringContaining(':bloqueio'),
        '1',
        'PX',
        BLOCK_MS,
      );
    });

    it('mantém bloqueado enquanto o prazo corre, sem contar de novo', async () => {
      client.pttl.mockResolvedValue(12_000);

      await expect(increment()).resolves.toMatchObject({
        isBlocked: true,
        timeToBlockExpire: 12,
      });
      // Já bloqueado: não há motivo para incrementar nem reescrever o bloqueio.
      expect(client.multi).not.toHaveBeenCalled();
      expect(client.set).not.toHaveBeenCalled();
    });

    it('não bloqueia exatamente no limite', async () => {
      counted(LIMIT);

      await expect(increment()).resolves.toMatchObject({ isBlocked: false });
      expect(client.set).not.toHaveBeenCalled();
    });
  });

  describe('Redis indisponível', () => {
    it('libera a requisição em vez de fechar a porta', async () => {
      client.pttl.mockRejectedValue(new Error(faker.lorem.sentence()));

      // Trocar limite de taxa por indisponibilidade total seria pior.
      await expect(increment()).resolves.toEqual({
        totalHits: 0,
        timeToExpire: TTL_MS / 1_000,
        isBlocked: false,
        timeToBlockExpire: 0,
      });
    });

    it('libera a requisição quando a transação não é aplicada', async () => {
      exec.mockResolvedValue(null);

      await expect(increment()).resolves.toMatchObject({ isBlocked: false });
    });
  });
});
