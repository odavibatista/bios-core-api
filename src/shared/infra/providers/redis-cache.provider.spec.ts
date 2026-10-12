import { Test } from '@nestjs/testing';
import {
  buildCacheValue,
  buildCnpj,
  buildTtlSeconds,
  cacheKeyFactory,
} from '@test/factories/shared/cache-entry.factory.js';
import { faker } from '@test/support/faker.js';
import {
  buildCacheKey,
  buildCacheKeysOf,
  CACHE_OPERATION_BUDGET_MS,
} from '../../config/cache.config.js';
import { CACHE_NAMESPACES } from '../../domain/dtos/providers/cache-key.dto.js';
import { REDIS_CLIENT } from '../redis/redis.service.js';
import { RedisCacheProvider } from './redis-cache.provider.js';

describe('RedisCacheProvider', () => {
  const client = {
    get: vi.fn<() => Promise<string | null>>(),
    set: vi.fn<() => Promise<string>>(),
    del: vi.fn<() => Promise<number>>(),
  };
  let cache: RedisCacheProvider;

  beforeEach(async () => {
    client.get.mockResolvedValue(null);
    client.set.mockResolvedValue('OK');
    client.del.mockResolvedValue(1);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RedisCacheProvider,
        { provide: REDIS_CLIENT, useValue: client },
      ],
    }).compile();

    cache = moduleRef.get(RedisCacheProvider);
  });

  describe('leitura e escrita', () => {
    it('grava o valor serializado sob a chave da entrada, com a janela pedida', async () => {
      const key = cacheKeyFactory.build();
      const value = buildCacheValue();
      const ttlSeconds = buildTtlSeconds();

      await cache.set(key, value, ttlSeconds);

      expect(client.set).toHaveBeenCalledWith(
        buildCacheKey(key),
        JSON.stringify(value),
        'EX',
        ttlSeconds,
      );
    });

    it('devolve o valor guardado', async () => {
      const value = buildCacheValue();
      client.get.mockResolvedValue(JSON.stringify(value));

      await expect(cache.get(cacheKeyFactory.build())).resolves.toEqual(value);
    });

    it('preserva tipos primitivos e nulos na ida e volta', async () => {
      const value = { score: 42, confident: false, sector: null };
      client.get.mockResolvedValue(JSON.stringify(value));

      await expect(cache.get(cacheKeyFactory.build())).resolves.toEqual(value);
    });

    it('devolve undefined quando não há entrada', async () => {
      client.get.mockResolvedValue(null);

      await expect(cache.get(cacheKeyFactory.build())).resolves.toBeUndefined();
    });

    it('remove uma entrada pela chave', async () => {
      const key = cacheKeyFactory.build();

      await cache.delete(key);

      expect(client.del).toHaveBeenCalledWith(buildCacheKey(key));
    });
  });

  describe('invalidação', () => {
    it('apaga o identificador em todos os namespaces, de uma vez', async () => {
      const identifier = buildCnpj();

      await cache.invalidate(identifier);

      // Um único DEL: nada de SCAN, cujo custo cresce com o tamanho do banco.
      expect(client.del).toHaveBeenCalledTimes(1);
      expect(client.del).toHaveBeenCalledWith(buildCacheKeysOf(identifier));
      expect(buildCacheKeysOf(identifier)).toHaveLength(
        CACHE_NAMESPACES.length,
      );
    });
  });

  describe('degradação quando o Redis falha', () => {
    it('trata a leitura com erro como ausência de dado', async () => {
      client.get.mockRejectedValue(new Error(faker.lorem.sentence()));

      await expect(cache.get(cacheKeyFactory.build())).resolves.toBeUndefined();
    });

    it('não propaga erro na escrita', async () => {
      client.set.mockRejectedValue(new Error(faker.lorem.sentence()));

      await expect(
        cache.set(cacheKeyFactory.build(), buildCacheValue(), 60),
      ).resolves.toBeUndefined();
    });

    it('não propaga erro na remoção', async () => {
      client.del.mockRejectedValue(new Error(faker.lorem.sentence()));

      await expect(
        cache.delete(cacheKeyFactory.build()),
      ).resolves.toBeUndefined();
    });

    it('não propaga erro na invalidação', async () => {
      client.del.mockRejectedValue(new Error(faker.lorem.sentence()));

      await expect(cache.invalidate(buildCnpj())).resolves.toBeUndefined();
    });

    it('trata entrada ilegível como ausência de dado', async () => {
      client.get.mockResolvedValue('{ nao e json }');

      await expect(cache.get(cacheKeyFactory.build())).resolves.toBeUndefined();
    });
  });

  describe('orçamento de latência', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('abandona a leitura que não responde a tempo, em vez de atrasar a consulta', async () => {
      // O cliente segura o comando enquanto tenta reconectar; o cache não espera.
      client.get.mockReturnValue(new Promise(() => undefined));

      const reading = cache.get(cacheKeyFactory.build());
      await vi.advanceTimersByTimeAsync(CACHE_OPERATION_BUDGET_MS);

      await expect(reading).resolves.toBeUndefined();
    });

    it('abandona a escrita que não responde a tempo', async () => {
      client.set.mockReturnValue(new Promise(() => undefined));

      const writing = cache.set(cacheKeyFactory.build(), buildCacheValue(), 60);
      await vi.advanceTimersByTimeAsync(CACHE_OPERATION_BUDGET_MS);

      await expect(writing).resolves.toBeUndefined();
    });

    it('abandona a invalidação que não responde a tempo', async () => {
      client.del.mockReturnValue(new Promise(() => undefined));

      const invalidating = cache.invalidate(buildCnpj());
      await vi.advanceTimersByTimeAsync(CACHE_OPERATION_BUDGET_MS);

      await expect(invalidating).resolves.toBeUndefined();
    });

    it('não abandona a operação que responde dentro do orçamento', async () => {
      const value = buildCacheValue();
      client.get.mockReturnValue(
        new Promise((resolve) =>
          setTimeout(() => resolve(JSON.stringify(value)), 1),
        ),
      );

      const reading = cache.get(cacheKeyFactory.build());
      await vi.advanceTimersByTimeAsync(1);

      await expect(reading).resolves.toEqual(value);
    });
  });
});
