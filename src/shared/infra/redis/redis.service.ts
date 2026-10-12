import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { RedisHealthProvider } from '../../domain/providers/redis-health.provider.js';

/** Token do cliente Redis, construído pelo `QueueModule`. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/** Tempo máximo de espera pela resposta do Redis no health check. */
export const REDIS_HEALTH_TIMEOUT_MS = 3_000;

/**
 * Conexão própria com o Redis, usada para verificar a disponibilidade.
 *
 * É uma conexão separada das do BullMQ de propósito: o health check não depende
 * do estado interno da biblioteca de filas, e um `PING` prova que o Redis
 * responde agora — diferente de uma conexão que já foi estabelecida e pode ter
 * caído desde então.
 *
 * O ouvinte de `error` existe porque o cliente emite o evento a cada tentativa
 * de conexão e, sem ouvinte, a emissão derrubaria o processo.
 */
@Injectable()
export class RedisService implements OnModuleDestroy, RedisHealthProvider {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {
    this.client.on('error', ({ message }: Error) => {
      this.logger.warn(`Redis indisponível: ${message}`);
    });
  }

  onModuleDestroy(): void {
    // `disconnect` encerra sem aguardar resposta: com o Redis fora do ar, um
    // `quit` ficaria pendurado e atrasaria o desligamento da aplicação.
    this.client.disconnect();
  }

  /**
   * Verifica se o Redis responde a um `PING` dentro do tempo limite.
   */
  async isAvailable(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), REDIS_HEALTH_TIMEOUT_MS);
    });

    const ping = this.client.ping().then(
      (response) => response === 'PONG',
      () => false,
    );

    try {
      return await Promise.race([ping, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
