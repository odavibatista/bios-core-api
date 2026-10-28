import { RedisSourceRateLimiter } from '@modules/data-sources/infra/providers/redis-source-rate-limiter.provider.js';
import { Redis } from 'ioredis';
import { inject } from 'vitest';
import { faker } from '../support/faker.js';
import { resetSourceRateLimits } from '../support/source-rate-limit.js';
import { testRedisUrl } from '../support/infrastructure.js';

const REDIS_URL = testRedisUrl();

/**
 * Limite de requisições às fontes contra Redis real (NFPD01): o teto vale por
 * janela móvel de um minuto, é atômico entre chamadas concorrentes e separado
 * por fonte.
 */
describe.runIf(inject('redisAvailable'))(
  'Limite de requisições às fontes (e2e)',
  () => {
    let client: Redis;
    let limiter: RedisSourceRateLimiter;

    beforeAll(() => {
      client = new Redis(REDIS_URL);
      limiter = new RedisSourceRateLimiter(client);
    });

    beforeEach(async () => {
      await resetSourceRateLimits(REDIS_URL);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    afterAll(async () => {
      await resetSourceRateLimits(REDIS_URL);
      client.disconnect();
    });

    async function acquireMany(
      slug: string,
      limit: number,
      times: number,
    ): Promise<boolean[]> {
      const results: boolean[] = [];

      for (let attempt = 0; attempt < times; attempt += 1) {
        results.push(await limiter.tryAcquire(slug, limit));
      }

      return results;
    }

    it('deixa passar até o teto e recusa a partir dele', async () => {
      const results = await acquireMany('BRASIL_API', 3, 5);

      expect(results).toEqual([true, true, true, false, false]);
    });

    it('é atômico: chamadas simultâneas nunca passam do teto', async () => {
      const results = await Promise.all(
        Array.from({ length: 60 }, () => limiter.tryAcquire('BRASIL_API', 10)),
      );

      expect(results.filter(Boolean)).toHaveLength(10);
    });

    it('conta cada fonte à parte', async () => {
      await acquireMany('BRASIL_API', 2, 2);

      await expect(limiter.tryAcquire('BRASIL_API', 2)).resolves.toBe(false);
      await expect(limiter.tryAcquire('OPEN_CNPJ', 2)).resolves.toBe(true);
    });

    it('a chamada recusada não consome cota', async () => {
      await acquireMany('BRASIL_API', 2, 10);

      const stored = await client.zcard('bios:source-rate:BRASIL_API');

      expect(stored).toBe(2);
    });

    it('o teto é da janela móvel: nada se libera no meio do minuto', async () => {
      vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
      await acquireMany('BRASIL_API', 2, 2);

      vi.setSystemTime(Date.now() + 59_000);

      await expect(limiter.tryAcquire('BRASIL_API', 2)).resolves.toBe(false);
    });

    it('depois de um minuto, as chamadas antigas saem da janela e a cota volta', async () => {
      vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
      await acquireMany('BRASIL_API', 2, 2);

      vi.setSystemTime(Date.now() + 61_000);

      await expect(limiter.tryAcquire('BRASIL_API', 2)).resolves.toBe(true);
    });

    it('não permite o pico duplo de uma janela fixa na virada do minuto', async () => {
      // Teto de 2. Duas chamadas aos 50 s e mais duas aos 70 s: numa janela
      // fixa de relógio isso passaria (4 chamadas em 20 s); na móvel, não.
      vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
      const start = Date.now();
      vi.setSystemTime(start + 50_000);
      await acquireMany('BRASIL_API', 2, 2);

      vi.setSystemTime(start + 70_000);
      const results = await acquireMany('BRASIL_API', 2, 2);

      expect(results).toEqual([false, false]);
    });

    it('limpa a chave sozinha: expira depois de um minuto sem uso', async () => {
      await limiter.tryAcquire('BRASIL_API', 5);

      const ttl = await client.pttl('bios:source-rate:BRASIL_API');

      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60_000);
    });

    it('rejeita quando o Redis está fora do ar, em vez de liberar a chamada', async () => {
      const unreachable = new Redis('redis://localhost:6399/1', {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      });
      unreachable.on('error', () => undefined);

      await expect(
        new RedisSourceRateLimiter(unreachable).tryAcquire(
          faker.string.alpha(8),
          10,
        ),
      ).rejects.toThrow();

      unreachable.disconnect();
    });
  },
);
