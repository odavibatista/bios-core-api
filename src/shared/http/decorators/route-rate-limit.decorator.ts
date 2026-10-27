import { applyDecorators, SetMetadata } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { RouteThrottlerName } from '../../config/throttler.config.js';

/** Chave do metadado que diz qual limite próprio vale para a rota. */
export const ROUTE_RATE_LIMIT = 'bios:route-rate-limit';

/**
 * Submete a rota a um limite próprio, configurável por variável de ambiente (NFSE04).
 *
 * O limite próprio **substitui** o geral na rota (o `default` é dispensado), como o antigo
 * `@Throttle({ default: ... })` fazia, mas o valor vem da configuração validada e não do
 * código: ajustar um limite não exige novo deploy do código. Cada limite só incide nas
 * rotas que o declaram, e é contado por IP, como o geral.
 */
export const RouteRateLimit = (
  name: RouteThrottlerName,
): MethodDecorator & ClassDecorator =>
  applyDecorators(
    SetMetadata(ROUTE_RATE_LIMIT, name),
    SkipThrottle({ default: true }),
  );
