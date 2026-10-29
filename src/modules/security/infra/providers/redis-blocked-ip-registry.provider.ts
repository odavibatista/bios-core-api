import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { AccessBlockScope } from '@prisma/client';
import { REDIS_CLIENT } from '@shared/infra/redis/redis.service.js';
import type { Redis } from 'ioredis';
import { AccessBlockRepository } from '../../domain/dtos/repositories/access-block.repository.js';
import { BlockedIpRegistry } from '../../domain/providers/blocked-ip-registry.provider.js';

/** Conjunto, no Redis, dos IPs bloqueados sem prazo. */
export const BLOCKED_IPS_KEY = 'bios:blocked-ips';

/**
 * IPs bloqueados sem prazo espelhados num conjunto do Redis (`SISMEMBER` a cada requisição).
 *
 *  - Na subida da API, o conjunto é recarregado do banco: um Redis novo ou limpo não deixa
 *    passar quem o banco bloqueou.
 *  - Redis fora do ar: a consulta vai ao banco. Se o banco também falhar, quem chamou
 *    decide (o middleware deixa a requisição seguir: o honeypot não pode derrubar as rotas
 *    reais, NFSE07).
 */
@Injectable()
export class RedisBlockedIpRegistry
  extends BlockedIpRegistry
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(RedisBlockedIpRegistry.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    private readonly blocks: AccessBlockRepository,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      const ips = await this.blocks.findPermanentlyBlockedIps();

      if (ips.length > 0) await this.client.sadd(BLOCKED_IPS_KEY, ...ips);
    } catch (error) {
      this.logger.warn(
        `IPs bloqueados não recarregados no Redis (${describe(error)}): a consulta vai ao banco enquanto o Redis não os tiver.`,
      );
    }
  }

  async isBlocked(ip: string): Promise<boolean> {
    try {
      return (await this.client.sismember(BLOCKED_IPS_KEY, ip)) === 1;
    } catch {
      const block = await this.blocks.findActive(
        [{ scope: AccessBlockScope.IP, ip }],
        new Date(),
      );

      return block !== null && block.blockedUntil === null;
    }
  }

  async add(ip: string): Promise<void> {
    try {
      await this.client.sadd(BLOCKED_IPS_KEY, ip);
    } catch (error) {
      // O bloqueio já está no banco: a consulta com o Redis fora vai até lá, e a próxima
      // subida o espelha.
      this.logger.warn(
        `IP bloqueado não espelhado no Redis (${describe(error)}).`,
      );
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
