import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { REDIS_CLIENT } from '@shared/infra/redis/redis.service.js';
import type { Redis } from 'ioredis';
import { SourceRateLimiter } from '../../domain/providers/source-rate-limiter.provider.js';

/** Prefixo das chaves de contagem no Redis. */
export const SOURCE_RATE_KEY_PREFIX = 'bios:source-rate';

/** Janela do limite: as fontes declaram o teto por minuto. */
const WINDOW_MS = 60_000;

/**
 * Janela móvel de um minuto, atômica: remove as chamadas que saíram da janela,
 * recusa se o teto já foi atingido e, do contrário, registra esta.
 *
 * Em Lua porque a decisão (contar e só então registrar) precisa acontecer sem
 * que outra instância se intercale entre as duas etapas.
 */
const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

if redis.call('ZCARD', key) >= limit then
  return 0
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)

return 1
`;

/**
 * Limite de requisições às fontes externas em Redis (NFPD01).
 *
 * **Janela móvel**, e não fixa: numa janela fixa o teto vale por minuto do
 * relógio, e um pico no fim de um minuto somado a outro no começo do seguinte
 * dobraria o que a fonte aceita num intervalo de um minuto qualquer. Em Redis
 * porque o teto é da fonte, e todas as instâncias e workers dividem a mesma
 * cota.
 *
 * Diferente do limite da API (`RedisThrottlerStorage`), **não libera a
 * chamada** quando o Redis falha: lá o custo de errar é deixar passar uma
 * requisição; aqui é arriscar o bloqueio do BIOS pela fonte.
 */
@Injectable()
export class RedisSourceRateLimiter extends SourceRateLimiter {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {
    super();
  }

  override async tryAcquire(
    slug: string,
    limitPerMinute: number,
  ): Promise<boolean> {
    const acquired = await this.client.eval(
      ACQUIRE_SCRIPT,
      1,
      `${SOURCE_RATE_KEY_PREFIX}:${slug}`,
      Date.now(),
      WINDOW_MS,
      limitPerMinute,
      randomUUID(),
    );

    return acquired === 1;
  }
}
