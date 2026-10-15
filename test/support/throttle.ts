import { THROTTLER_KEY_PREFIX } from '@shared/config/throttler.config.js';
import { Redis } from 'ioredis';

/**
 * Zera os contadores do limite de requisições no Redis de teste.
 *
 * As suítes que sobem o `AppModule` fazem dezenas de requisições do mesmo IP, e
 * os contadores sobrevivem entre arquivos dentro da janela de um minuto: sem
 * zerá-los, o teto de requisições estouraria por soma de suítes e não por
 * defeito do que se testa. O comportamento do limite em si tem suíte própria.
 *
 * Só toca nas chaves do limite (`bios:throttle*`) do banco descartável.
 */
export async function resetThrottleCounters(redisUrl: string): Promise<void> {
  const redis = new Redis(redisUrl);

  try {
    const keys = await redis.keys(`${THROTTLER_KEY_PREFIX}*`);

    if (keys.length > 0) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}
