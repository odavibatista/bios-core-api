import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Environment } from '../../config/environment.config.js';
import { CacheProvider } from '../../domain/providers/cache.provider.js';
import { RedisHealthProvider } from '../../domain/providers/redis-health.provider.js';
import { RedisCacheProvider } from '../providers/redis-cache.provider.js';
import { REDIS_CLIENT, RedisService } from '../redis/redis.service.js';

/**
 * Módulo global do Redis: cache de consultas (NFDE01) e verificação de
 * disponibilidade.
 *
 * As filas não entram aqui. O BullMQ administra as próprias conexões a partir
 * das mesmas opções (`QueueModule`), inclusive bloqueantes, e compartilhar um
 * cliente entre ele e o cache acoplaria os dois usos a um só pool.
 *
 * `lazyConnect` deixa a aplicação subir com o Redis fora do ar: o health check
 * reporta a falha e o cache degrada para ausência de dado, em vez de o boot ser
 * impedido.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Environment, true>) =>
        new Redis(configService.get('REDIS_URL', { infer: true }), {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        }),
    },
    RedisService,
    { provide: RedisHealthProvider, useExisting: RedisService },
    RedisCacheProvider,
    { provide: CacheProvider, useExisting: RedisCacheProvider },
  ],
  // O cliente é exportado porque os contadores do limite de requisições
  // (`RedisThrottlerStorage`) usam a mesma conexão do cache.
  exports: [REDIS_CLIENT, RedisHealthProvider, CacheProvider],
})
export class RedisModule {}
