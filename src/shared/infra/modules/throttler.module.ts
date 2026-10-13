import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule as NestThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Environment } from '../../config/environment.config.js';
import { buildThrottlers } from '../../config/throttler.config.js';
import { ApiThrottlerGuard } from '../../http/guards/api-throttler.guard.js';
import { RedisThrottlerStorage } from '../providers/redis-throttler.storage.js';
import { RedisModule } from './redis.module.js';

/**
 * Limite de requisições dos endpoints (NFSE04).
 *
 * A guarda é global: todo endpoint passa a ser contado, e quem deve ficar de
 * fora se declara com `@SkipThrottle()` — é o caso do health check, que precisa
 * responder a cada sondagem do orquestrador. Limites mais estritos em
 * endpoints sensíveis saem de `@Throttle({ default: { limit, ttl } })` no
 * próprio controller.
 *
 * Os contadores ficam no Redis (`RedisModule`), porque o limite é do consumidor
 * e não da instância.
 */
@Module({
  imports: [
    RedisModule,
    NestThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Environment, true>) => ({
        throttlers: buildThrottlers(configService),
      }),
    }),
  ],
  providers: [
    { provide: ThrottlerStorage, useClass: RedisThrottlerStorage },
    { provide: APP_GUARD, useClass: ApiThrottlerGuard },
  ],
})
export class ThrottlerModule {}
