import { Injectable } from '@nestjs/common';
import {
  AccessBlockScope,
  LoginFailureReason,
  type Prisma,
} from '@prisma/client';
import type { AccessBlockTarget } from '@modules/security/domain/dtos/repositories/access-block.repository.js';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  type FailedLoginAttempt,
  LoginAttemptRepository,
  type SuccessfulLoginAttempt,
} from '../../../domain/dtos/repositories/login-attempt.repository.js';

/** Filtro das tentativas do alvo: as de um IP, ou as dirigidas a uma conta. */
function whereTarget(target: AccessBlockTarget): Prisma.LoginAttemptWhereInput {
  return target.scope === AccessBlockScope.IP
    ? { ip: target.ip }
    : { user_id: target.userId };
}

/**
 * Tentativas de login no MongoDB (RF19).
 *
 * Cada tentativa vira um registro; a contagem de falhas consecutivas (RF20) é
 * derivada deles, sem contador separado para manter em sincronia. Os índices
 * por IP e por usuário, ambos com a data, cobrem as duas consultas.
 */
@Injectable()
export class PrismaLoginAttemptRepository
  extends PrismaRepository
  implements LoginAttemptRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async recordFailure({
    userId,
    ip,
    reason,
  }: FailedLoginAttempt): Promise<void> {
    await this.prisma.loginAttempt.create({
      data: {
        user_id: userId,
        ip,
        was_successful: false,
        failure_reason: reason,
      },
    });
  }

  async recordSuccess({ userId, ip }: SuccessfulLoginAttempt): Promise<void> {
    await this.prisma.loginAttempt.create({
      data: { user_id: userId, ip, was_successful: true },
    });
  }

  async countFailuresSinceLastSuccess(
    target: AccessBlockTarget,
    notBefore: Date | null,
  ): Promise<number> {
    const lastSuccess = await this.prisma.loginAttempt.findFirst({
      where: { ...whereTarget(target), was_successful: true },
      orderBy: { attempted_at: 'desc' },
      select: { attempted_at: true },
    });

    const since = [lastSuccess?.attempted_at, notBefore].reduce<Date | null>(
      (latest, date) => (date && (!latest || date > latest) ? date : latest),
      null,
    );

    return this.prisma.loginAttempt.count({
      where: {
        ...whereTarget(target),
        was_successful: false,
        failure_reason: LoginFailureReason.INVALID_CREDENTIALS,
        ...(since && { attempted_at: { gt: since } }),
      },
    });
  }
}
