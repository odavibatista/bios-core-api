import { Injectable } from '@nestjs/common';
import {
  AccessBlockReason,
  AccessBlockScope,
  type Prisma,
} from '@prisma/client';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  type AccessBlockTarget,
  AccessBlockRepository,
  type ActiveAccessBlock,
  type NewAccessBlock,
} from '../../../domain/dtos/repositories/access-block.repository.js';

/** Filtro do alvo: o IP bloqueado, ou o usuário bloqueado. */
function whereTarget(target: AccessBlockTarget): Prisma.AccessBlockWhereInput {
  return target.scope === AccessBlockScope.IP
    ? { scope: AccessBlockScope.IP, ip: target.ip }
    : { scope: AccessBlockScope.USER, user_id: target.userId };
}

/**
 * Bloqueios de acesso no MongoDB.
 *
 * Bloqueio sem prazo (`blocked_until` ausente ou nulo) vale para sempre. O
 * campo omitido fica ausente do documento, e o Prisma só casa `null` com valor
 * explícito: por isso o filtro trata as duas formas.
 */
@Injectable()
export class PrismaAccessBlockRepository
  extends PrismaRepository
  implements AccessBlockRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findActive(
    targets: readonly AccessBlockTarget[],
    now: Date,
  ): Promise<ActiveAccessBlock | null> {
    if (targets.length === 0) return null;

    const blocks = await this.prisma.accessBlock.findMany({
      where: {
        OR: targets.map(whereTarget),
        AND: [
          {
            OR: [
              { blocked_until: { gt: now } },
              { blocked_until: null },
              { blocked_until: { isSet: false } },
            ],
          },
        ],
      },
      select: { blocked_until: true },
    });

    if (blocks.length === 0) return null;

    // Um bloqueio sem prazo prevalece sobre qualquer outro.
    if (blocks.some(({ blocked_until }) => blocked_until === null)) {
      return { blockedUntil: null };
    }

    const latest = Math.max(
      ...blocks.map(({ blocked_until }) => blocked_until!.getTime()),
    );

    return { blockedUntil: new Date(latest) };
  }

  async create({
    target,
    reason,
    blockedUntil,
  }: NewAccessBlock): Promise<void> {
    await this.prisma.accessBlock.create({
      data: {
        scope: target.scope,
        ip: target.scope === AccessBlockScope.IP ? target.ip : undefined,
        user_id:
          target.scope === AccessBlockScope.USER ? target.userId : undefined,
        reason,
        blocked_until: blockedUntil ?? undefined,
      },
    });
  }

  async findLastLoginBlockStart(
    target: AccessBlockTarget,
  ): Promise<Date | null> {
    const block = await this.prisma.accessBlock.findFirst({
      where: {
        ...whereTarget(target),
        reason: AccessBlockReason.LOGIN_ATTEMPTS,
      },
      orderBy: { created_at: 'desc' },
      select: { created_at: true },
    });

    return block?.created_at ?? null;
  }
}
