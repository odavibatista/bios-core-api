import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { validateEnvironment } from '@shared/config/environment.config.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { RedisModule } from '@shared/infra/modules/redis.module.js';
import { inject } from 'vitest';
import {
  buildCacheValue,
  buildCnpj,
  cacheKeyFactory,
} from '../factories/shared/cache-entry.factory.js';
import { buildTestEnvironment } from '../support/environment.js';

const REDIS_URL = inject('testRedisUrl');

/** Limite de resposta de um perfil em cache (NFDE02). */
const RESPONSE_BUDGET_MS = 2_000;

/**
 * Cache contra um Redis real: a expiração, a serialização e o custo da leitura
 * são comportamento do próprio Redis, que nenhum dublê demonstra.
 */
describe.runIf(inject('redisAvailable'))('Cache com Redis real (e2e)', () => {
  let moduleRef: TestingModule;
  let cache: CacheProvider;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => validateEnvironment(buildTestEnvironment({ REDIS_URL })),
          ],
        }),
        RedisModule,
      ],
    }).compile();

    cache = moduleRef.get(CacheProvider);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('devolve o valor guardado', async () => {
    const key = cacheKeyFactory.build();
    const value = buildCacheValue();

    await cache.set(key, value, 60);

    await expect(cache.get(key)).resolves.toEqual(value);
  });

  it('não devolve valor de chave nunca gravada', async () => {
    await expect(cache.get(cacheKeyFactory.build())).resolves.toBeUndefined();
  });

  it('esquece a entrada quando a janela de validade termina', async () => {
    const key = cacheKeyFactory.build();

    // Janela de 1s: o Redis é quem expira a chave, não o código.
    await cache.set(key, buildCacheValue(), 1);
    await expect(cache.get(key)).resolves.not.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    await expect(cache.get(key)).resolves.toBeUndefined();
  });

  it('responde um perfil em cache bem dentro do limite de 2s (NFDE02)', async () => {
    const key = {
      namespace: CacheNamespace.COMPANY_PROFILE,
      identifier: buildCnpj(),
    };
    await cache.set(key, buildCacheValue(), 60);

    const started = performance.now();
    const profile = await cache.get(key);
    const elapsed = performance.now() - started;

    expect(profile).not.toBeUndefined();
    expect(elapsed).toBeLessThan(RESPONSE_BUDGET_MS);
  });

  it('remove uma entrada específica sem tocar nas demais', async () => {
    const identifier = buildCnpj();
    const profile = {
      namespace: CacheNamespace.COMPANY_PROFILE,
      identifier,
    };
    const scores = { namespace: CacheNamespace.COMPANY_SCORES, identifier };
    await cache.set(profile, buildCacheValue(), 60);
    await cache.set(scores, buildCacheValue(), 60);

    await cache.delete(profile);

    await expect(cache.get(profile)).resolves.toBeUndefined();
    await expect(cache.get(scores)).resolves.not.toBeUndefined();
  });

  it('invalida o CNPJ em todos os namespaces de uma vez', async () => {
    const identifier = buildCnpj();
    const keys = [
      { namespace: CacheNamespace.COMPANY_PROFILE, identifier },
      { namespace: CacheNamespace.COMPANY_EVIDENCES, identifier },
      { namespace: CacheNamespace.COMPANY_SCORES, identifier },
    ];
    const survivor = {
      namespace: CacheNamespace.COMPANY_PROFILE,
      identifier: buildCnpj(),
    };
    await Promise.all(
      [...keys, survivor].map((key) => cache.set(key, buildCacheValue(), 60)),
    );

    await cache.invalidate(identifier);

    for (const key of keys) {
      await expect(cache.get(key)).resolves.toBeUndefined();
    }
    // Outra empresa não é afetada.
    await expect(cache.get(survivor)).resolves.not.toBeUndefined();
  });
});
