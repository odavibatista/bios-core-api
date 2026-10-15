import { Injectable } from '@nestjs/common';
import { Prisma, SessionRevocationReason } from '@prisma/client';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  type NewUserSession,
  type SessionRotation,
  UserSessionRepository,
  type UserSessionLink,
} from '../../../domain/dtos/repositories/user-session.repository.js';

/** Código do Prisma para transação abortada por conflito de escrita. */
const WRITE_CONFLICT = 'P2034';

/**
 * Elo ainda não revogado.
 *
 * `revoked_at: null` sozinho não basta no MongoDB: o campo omitido na criação
 * fica ausente do documento, e o Prisma só casa `null` com valor explícito.
 * Sem tratar a ausência, nenhum elo recém-criado seria encontrado.
 */
const NOT_REVOKED = {
  OR: [{ revoked_at: null }, { revoked_at: { isSet: false } }],
} satisfies Prisma.UserSessionWhereInput;

/**
 * Sessões de usuário no MongoDB.
 *
 * Só o resumo do refresh token é gravado; o valor puro existe apenas na
 * resposta do login e da renovação.
 */
@Injectable()
export class PrismaUserSessionRepository
  extends PrismaRepository
  implements UserSessionRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async create(session: NewUserSession): Promise<string> {
    const { id_user_session } = await this.prisma.userSession.create({
      data: toCreateData(session),
      select: { id_user_session: true },
    });

    return id_user_session;
  }

  async findByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<UserSessionLink | null> {
    const session = await this.prisma.userSession.findUnique({
      where: { refresh_token_hash: refreshTokenHash },
      select: {
        id_user_session: true,
        user_id: true,
        family_id: true,
        expires_at: true,
        revoked_at: true,
        revocation_reason: true,
      },
    });

    return session
      ? {
          id: session.id_user_session,
          userId: session.user_id,
          familyId: session.family_id,
          expiresAt: session.expires_at,
          revokedAt: session.revoked_at,
          revocationReason: session.revocation_reason,
        }
      : null;
  }

  async rotate({
    currentSessionId,
    next,
    now,
  }: SessionRotation): Promise<string | null> {
    try {
      return await this.transaction(async (transaction) => {
        // A condição é o que decide a disputa: só um pedido revoga o elo, e
        // quem chega depois encontra `count` zero.
        const { count } = await transaction.userSession.updateMany({
          where: {
            id_user_session: currentSessionId,
            ...NOT_REVOKED,
            expires_at: { gt: now },
          },
          data: {
            revoked_at: now,
            revocation_reason: SessionRevocationReason.ROTATED,
          },
        });

        if (count !== 1) return null;

        const { id_user_session } = await transaction.userSession.create({
          data: toCreateData(next),
          select: { id_user_session: true },
        });

        await transaction.userSession.update({
          where: { id_user_session: currentSessionId },
          data: { replaced_by_session_id: id_user_session },
        });

        return id_user_session;
      });
    } catch (error) {
      // O MongoDB aborta a transação de quem perde a disputa pelo mesmo
      // documento. Para quem renova, é o mesmo desfecho de ter chegado tarde:
      // o elo já foi consumido por outro pedido.
      if (isWriteConflict(error)) return null;

      throw error;
    }
  }

  async revokeAllActive(
    userId: string,
    reason: SessionRevocationReason,
    revokedAt: Date,
  ): Promise<number> {
    const { count } = await this.prisma.userSession.updateMany({
      where: { user_id: userId, ...NOT_REVOKED },
      data: { revoked_at: revokedAt, revocation_reason: reason },
    });

    return count;
  }
}

function toCreateData({
  userId,
  familyId,
  refreshTokenHash,
  ip,
  userAgent,
  expiresAt,
}: NewUserSession): Prisma.UserSessionUncheckedCreateInput {
  return {
    user_id: userId,
    family_id: familyId,
    refresh_token_hash: refreshTokenHash,
    ip,
    user_agent: userAgent,
    expires_at: expiresAt,
  };
}

function isWriteConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === WRITE_CONFLICT
  );
}
