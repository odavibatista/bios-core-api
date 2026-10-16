import { SOURCE_RATE_KEY_PREFIX } from '@modules/data-sources/infra/providers/redis-source-rate-limiter.provider.js';
import { Redis } from 'ioredis';

/**
 * Zera os contadores do limite de requisições às fontes externas no Redis de
 * teste. Só toca nas chaves do limite (`bios:source-rate*`).
 */
export async function resetSourceRateLimits(redisUrl: string): Promise<void> {
  const redis = new Redis(redisUrl);

  try {
    const keys = await redis.keys(`${SOURCE_RATE_KEY_PREFIX}*`);

    if (keys.length > 0) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}
