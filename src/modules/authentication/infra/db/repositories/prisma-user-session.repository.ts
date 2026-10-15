import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  type NewUserSession,
  UserSessionRepository,
} from '../../../domain/dtos/repositories/user-session.repository.js';

/**
 * Sessões de usuário no MongoDB.
 *
 * Só o resumo do refresh token é gravado; o valor puro existe apenas na
 * resposta do login.
 */
@Injectable()
export class PrismaUserSessionRepository
  extends PrismaRepository
  implements UserSessionRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async create({
    userId,
    familyId,
    refreshTokenHash,
    ip,
    userAgent,
    expiresAt,
  }: NewUserSession): Promise<string> {
    const { id_user_session } = await this.prisma.userSession.create({
      data: {
        user_id: userId,
        family_id: familyId,
        refresh_token_hash: refreshTokenHash,
        ip,
        user_agent: userAgent,
        expires_at: expiresAt,
      },
      select: { id_user_session: true },
    });

    return id_user_session;
  }
}
