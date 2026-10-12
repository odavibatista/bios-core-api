import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  buildCacheKey,
  buildCacheKeysOf,
  CACHE_OPERATION_BUDGET_MS,
} from '../../config/cache.config.js';
import type { CacheKey } from '../../domain/dtos/providers/cache-key.dto.js';
import { CacheProvider } from '../../domain/providers/cache.provider.js';
import { REDIS_CLIENT } from '../redis/redis.service.js';

/**
 * Resultado de uma operação de cache: ou ela aconteceu e tem valor, ou não
 * aconteceu — por falha do Redis ou por estourar o orçamento de latência.
 */
type Attempt<T> = { done: true; value: T } | { done: false; timedOut: boolean };

/**
 * Cache de consultas em Redis (NFDE01, NFDE02).
 *
 * Toda operação é protegida de duas formas: falha do Redis é registrada em log
 * e tratada como ausência de dado, e nenhuma operação passa do orçamento de
 * latência (`CACHE_OPERATION_BUDGET_MS`). Uma consulta a CNPJ não pode falhar
 * — nem ficar mais lenta — porque o cache caiu: ela apenas vai à fonte
 * (NFCO01).
 *
 * Os valores são serializados em JSON. Valor ilegível (formato antigo gravado
 * por outra versão, ou conteúdo corrompido) também conta como ausência: o dado
 * é buscado de novo e a entrada, regravada.
 */
@Injectable()
export class RedisCacheProvider extends CacheProvider {
  private readonly logger = new Logger(RedisCacheProvider.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {
    super();
  }

  override async get<T>(key: CacheKey): Promise<T | undefined> {
    const attempt = await this.run(`leitura de ${buildCacheKey(key)}`, () =>
      this.client.get(buildCacheKey(key)),
    );

    if (!attempt.done || attempt.value === null) return undefined;

    try {
      return JSON.parse(attempt.value) as T;
    } catch {
      this.logger.warn(
        `Entrada ilegível em ${buildCacheKey(key)}: tratada como ausente.`,
      );
      return undefined;
    }
  }

  override async set<T>(
    key: CacheKey,
    value: T,
    ttlSeconds: number,
  ): Promise<void> {
    await this.run(`escrita de ${buildCacheKey(key)}`, () =>
      this.client.set(
        buildCacheKey(key),
        JSON.stringify(value),
        'EX',
        ttlSeconds,
      ),
    );
  }

  override async delete(key: CacheKey): Promise<void> {
    await this.run(`remoção de ${buildCacheKey(key)}`, () =>
      this.client.del(buildCacheKey(key)),
    );
  }

  override async invalidate(identifier: string): Promise<void> {
    // Um único DEL com todas as chaves: sem SCAN, cujo custo cresce com o
    // tamanho do banco.
    const attempt = await this.run(`invalidação de "${identifier}"`, () =>
      this.client.del(buildCacheKeysOf(identifier)),
    );

    if (!attempt.done) {
      // Diferente da leitura e da escrita, a invalidação que não acontece deixa
      // dado vencido servível até o fim do TTL — por isso o nível de erro.
      this.logger.error(
        `Invalidação de "${identifier}" não aplicada: o dado em cache pode ` +
          'ficar desatualizado até o fim da janela de validade.',
      );
    }
  }

  /**
   * Executa a operação dentro do orçamento de latência.
   */
  private async run<T>(
    description: string,
    execute: () => Promise<T>,
  ): Promise<Attempt<T>> {
    let timer: NodeJS.Timeout | undefined;
    const budget = new Promise<Attempt<T>>((resolve) => {
      timer = setTimeout(
        () => resolve({ done: false, timedOut: true }),
        CACHE_OPERATION_BUDGET_MS,
      );
    });
    // Os dois desfechos são tratados na própria promessa do comando: se o
    // orçamento vencer primeiro, a rejeição posterior já tem quem a trate.
    const command = execute().then(
      (value): Attempt<T> => ({ done: true, value }),
      (error: unknown): Attempt<T> => {
        this.logger.warn(
          `Cache indisponível na ${description}: ${describe(error)}`,
        );
        return { done: false, timedOut: false };
      },
    );

    try {
      const attempt = await Promise.race([command, budget]);

      if (!attempt.done && attempt.timedOut) {
        this.logger.warn(
          `Cache não respondeu em ${CACHE_OPERATION_BUDGET_MS}ms na ${description}.`,
        );
      }

      return attempt;
    } finally {
      clearTimeout(timer);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
