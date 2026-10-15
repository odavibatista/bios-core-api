import { CACHE_KEY_PREFIX } from '@shared/config/cache.config.js';
import { Redis } from 'ioredis';

/**
 * Apaga as entradas de cache de consultas no Redis de teste.
 *
 * O cache sobrevive entre testes e entre arquivos: sem apagá-lo, um perfil
 * guardado por um teste seria servido ao seguinte e esconderia o caminho que
 * ele quer exercitar. Só toca nas chaves de cache (`bios:cache*`) do banco
 * descartável.
 */
export async function resetCache(redisUrl: string): Promise<void> {
  const redis = new Redis(redisUrl);

  try {
    const keys = await redis.keys(`${CACHE_KEY_PREFIX}*`);

    if (keys.length > 0) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}
