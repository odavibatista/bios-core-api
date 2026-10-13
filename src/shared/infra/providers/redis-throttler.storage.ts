import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { THROTTLER_KEY_PREFIX } from '../../config/throttler.config.js';
import { REDIS_CLIENT } from '../redis/redis.service.js';

/**
 * Registro devolvido ao throttler. Derivado do próprio contrato: a biblioteca
 * não reexporta o tipo no índice do pacote.
 */
type ThrottlerRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** Converte milissegundos em segundos inteiros, como o contrato espera. */
function toSeconds(milliseconds: number): number {
  return Math.ceil(milliseconds / 1_000);
}

/**
 * Contagem de requisições em Redis (NFSE04).
 *
 * Em Redis, e não em memória, porque o limite tem de valer para o consumidor e
 * não para a instância: com duas instâncias da API, um contador por processo
 * dobraria o limite efetivo.
 *
 * A janela é fixa: o prazo é definido na primeira requisição (`PEXPIRE NX`) e
 * não se renova a cada chamada — do contrário, quem mantivesse o ritmo nunca
 * veria a janela expirar. Excedido o limite, uma chave de bloqueio responde
 * pelas requisições seguintes até vencer.
 *
 * **Falha do Redis libera a requisição.** Um contador indisponível não pode
 * virar porta fechada: seria trocar um limite de taxa por uma indisponibilidade
 * total. A falha é registrada como erro, porque nesse intervalo a proteção não
 * está valendo.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    const hitsKey = `${THROTTLER_KEY_PREFIX}:${throttlerName}:${key}`;
    const blockKey = `${hitsKey}:bloqueio`;

    try {
      const blockedFor = await this.client.pttl(blockKey);

      if (blockedFor > 0) {
        return {
          totalHits: limit + 1,
          timeToExpire: toSeconds(blockedFor),
          isBlocked: true,
          timeToBlockExpire: toSeconds(blockedFor),
        };
      }

      const [totalHits, remaining] = await this.count(hitsKey, ttl);

      if (totalHits > limit) {
        await this.client.set(blockKey, '1', 'PX', blockDuration);

        return {
          totalHits,
          timeToExpire: toSeconds(blockDuration),
          isBlocked: true,
          timeToBlockExpire: toSeconds(blockDuration),
        };
      }

      return {
        totalHits,
        timeToExpire: toSeconds(remaining),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Contador de requisições indisponível (${reason}): limite "${throttlerName}" ` +
          'não aplicado nesta requisição.',
      );

      return {
        totalHits: 0,
        timeToExpire: toSeconds(ttl),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  /**
   * Incrementa o contador e devolve o total e o que resta da janela, em uma só
   * ida ao Redis. `PEXPIRE ... NX` só define o prazo na primeira requisição da
   * janela, o que a mantém fixa.
   */
  private async count(
    hitsKey: string,
    ttl: number,
  ): Promise<[totalHits: number, remainingMs: number]> {
    const results = await this.client
      .multi()
      .incr(hitsKey)
      .pexpire(hitsKey, ttl, 'NX')
      .pttl(hitsKey)
      .exec();

    if (!results) {
      throw new Error('transação de contagem não foi aplicada');
    }

    const [[, totalHits], , [, remainingMs]] = results;

    return [Number(totalHits), Number(remainingMs)];
  }
}
