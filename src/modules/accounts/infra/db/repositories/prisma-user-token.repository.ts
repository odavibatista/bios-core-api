import { Injectable } from '@nestjs/common';
import type { UserToken } from '@prisma/client';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  type NewUserToken,
  type UserTokenConsumption,
  UserTokenRepository,
} from '../../../domain/dtos/repositories/user-token.repository.js';

/**
 * Tokens de uso único no MongoDB.
 *
 * Só o resumo é gravado (`token_hash`); o valor puro existe apenas no e-mail
 * enviado. A expiração física é do índice TTL de `expires_at` (retenção de
 * dados), mas a validade é sempre conferida aqui: o processo de expiração do
 * MongoDB roda a cada 60 segundos e um token vencido não pode valer nesse
 * intervalo.
 */
@Injectable()
export class PrismaUserTokenRepository
  extends PrismaRepository
  implements UserTokenRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async replacePending({
    userId,
    purpose,
    tokenHash,
    expiresAt,
    pendingEmailEncrypted,
  }: NewUserToken): Promise<void> {
    await this.transaction(async (transaction) => {
      await transaction.userToken.updateMany({
        where: { user_id: userId, purpose, used_at: null },
        data: { used_at: new Date() },
      });

      await transaction.userToken.create({
        data: {
          user_id: userId,
          purpose,
          token_hash: tokenHash,
          expires_at: expiresAt,
          pending_email_encrypted: pendingEmailEncrypted,
        },
      });
    });
  }

  async consume({
    tokenHash,
    purpose,
    now,
  }: UserTokenConsumption): Promise<UserToken | null> {
    const token = await this.prisma.userToken.findUnique({
      where: { token_hash: tokenHash },
    });

    if (!token || token.purpose !== purpose) return null;

    // A condição repete a validade e exige o token ainda livre: é ela, e não a
    // leitura acima, que decide quem consome quando duas requisições disputam
    // o mesmo link.
    const { count } = await this.prisma.userToken.updateMany({
      where: {
        id_user_token: token.id_user_token,
        used_at: null,
        expires_at: { gt: now },
      },
      data: { used_at: now },
    });

    return count === 1 ? { ...token, used_at: now } : null;
  }
}
