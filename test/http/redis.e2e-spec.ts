import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { validateEnvironment } from '@shared/config/environment.config.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { RedisHealthProvider } from '@shared/domain/providers/redis-health.provider.js';
import { RedisModule } from '@shared/infra/modules/redis.module.js';
import { RedisCacheProvider } from '@shared/infra/providers/redis-cache.provider.js';
import { RedisService } from '@shared/infra/redis/redis.service.js';
import {
  buildCacheValue,
  buildCnpj,
} from '../factories/shared/cache-entry.factory.js';

/** Porta sem serviço: representa o Redis fora do ar. */
const UNREACHABLE_REDIS_URL = 'redis://localhost:6399/1';

function createModule(
  environment: Record<string, string>,
): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => validateEnvironment(environment)],
      }),
      RedisModule,
    ],
  }).compile();
}

describe('Redis: cache e health check (e2e)', () => {
  const baseEnvironment = {
    DATABASE_URL: 'mongodb://localhost:27017/bios_test?directConnection=true',
    REDIS_URL: 'redis://localhost:6379/1',
    ENCRYPTION_KEYS: `1:${'e'.repeat(43)}=`,
    BLIND_INDEX_KEY: `${'b'.repeat(43)}=`,
  };

  it('injeta os providers pelos contratos de domínio', async () => {
    const moduleRef = await createModule(baseEnvironment);

    expect(moduleRef.get(RedisHealthProvider)).toBeInstanceOf(RedisService);
    expect(moduleRef.get(CacheProvider)).toBeInstanceOf(RedisCacheProvider);

    await moduleRef.close();
  });

  describe('com o Redis fora do ar', () => {
    let moduleRef: TestingModule;

    beforeAll(async () => {
      moduleRef = await createModule({
        ...baseEnvironment,
        REDIS_URL: UNREACHABLE_REDIS_URL,
      });
    });

    afterAll(async () => {
      await moduleRef.close();
    });

    it('sobe sem bloquear a inicialização, e o health check acusa a falha', async () => {
      await expect(
        moduleRef.get(RedisHealthProvider).isAvailable(),
      ).resolves.toBe(false);
    });

    it('degrada o cache para ausência de dado, sem erro para quem chamou', async () => {
      const cache = moduleRef.get(CacheProvider);
      const key = {
        namespace: CacheNamespace.COMPANY_PROFILE,
        identifier: buildCnpj(),
      };

      // Nenhuma das operações estoura: a consulta segue sem cache (NFCO01).
      await expect(
        cache.set(key, buildCacheValue(), 60),
      ).resolves.toBeUndefined();
      await expect(cache.get(key)).resolves.toBeUndefined();
      await expect(cache.delete(key)).resolves.toBeUndefined();
      await expect(cache.invalidate(key.identifier)).resolves.toBeUndefined();
    });
  });
});
