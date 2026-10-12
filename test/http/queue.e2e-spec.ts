import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { validateEnvironment } from '@shared/config/environment.config.js';
import { QueueProvider } from '@shared/domain/providers/queue.provider.js';
import { RedisHealthProvider } from '@shared/domain/providers/redis-health.provider.js';
import { QueueModule } from '@shared/infra/modules/queue.module.js';
import { BullMqQueueProvider } from '@shared/infra/providers/bullmq-queue.provider.js';
import { RedisService } from '@shared/infra/redis/redis.service.js';

/**
 * Monta o módulo de filas com a configuração real (variáveis validadas pelo
 * `ConfigModule`). Nenhuma conexão é aberta aqui: o Redis é configurado como
 * `lazyConnect`, justamente para a aplicação subir com ele fora do ar.
 */
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
      QueueModule,
    ],
  }).compile();
}

describe('Infraestrutura de filas (e2e)', () => {
  const baseEnvironment = {
    DATABASE_URL: 'mongodb://localhost:27017/bios_test?directConnection=true',
    REDIS_URL: 'redis://localhost:6379/1',
    ENCRYPTION_KEYS: `1:${'e'.repeat(43)}=`,
    BLIND_INDEX_KEY: `${'b'.repeat(43)}=`,
  };

  it('injeta os providers pelos contratos de domínio', async () => {
    const moduleRef = await createModule(baseEnvironment);

    expect(moduleRef.get(QueueProvider)).toBeInstanceOf(BullMqQueueProvider);
    expect(moduleRef.get(RedisHealthProvider)).toBeInstanceOf(RedisService);

    await moduleRef.close();
  });

  it('sobe com o Redis fora do ar, sem bloquear a inicialização', async () => {
    // Porta sem serviço: o módulo compila e só o health check acusa a falha.
    const moduleRef = await createModule({
      ...baseEnvironment,
      REDIS_URL: 'redis://localhost:6399/1',
    });

    await expect(
      moduleRef.get(RedisHealthProvider).isAvailable(),
    ).resolves.toBe(false);

    await moduleRef.close();
  });

  it.each([
    ['com URL de outro protocolo', 'amqp://localhost:5672'],
    ['sem esquema', 'localhost:6379'],
  ])('impede a aplicação de subir %s', async (_case, url) => {
    await expect(
      createModule({ ...baseEnvironment, REDIS_URL: url }),
    ).rejects.toThrow(/REDIS_URL/);
  });

  it('impede a aplicação de subir sem o Redis configurado', async () => {
    const withoutRedis = Object.fromEntries(
      Object.entries(baseEnvironment).filter(([name]) => name !== 'REDIS_URL'),
    );

    await expect(createModule(withoutRedis)).rejects.toThrow(/REDIS_URL/);
  });
});
