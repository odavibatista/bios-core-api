import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  type AccountCredentials,
  type AccountSecrets,
  type UserUpdate,
  UserUpdateOutcome,
  type AccountIdentity,
  type AccountProfile,
  type NewUser,
  UserRepository,
} from '../../../domain/dtos/repositories/user.repository.js';

/** Código do Prisma para violação de índice único. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Contas de usuário no MongoDB.
 *
 * Campos opcionais (`email_confirmed_at`, `address_encrypted`...) não são
 * gravados na criação e ficam ausentes do documento. Qualquer filtro futuro
 * sobre eles deve tratar a ausência (`isSet: false`), e não apenas `null`.
 */
@Injectable()
export class PrismaUserRepository
  extends PrismaRepository
  implements UserRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async createInactive({
    name,
    emailEncrypted,
    emailHash,
    passwordEncrypted,
    encryptionKeyVersion,
  }: NewUser): Promise<string | null> {
    try {
      const { id_user } = await this.prisma.user.create({
        data: {
          user_name: name,
          email_encrypted: emailEncrypted,
          email_hash: emailHash,
          password_encrypted: passwordEncrypted,
          encryption_key_version: encryptionKeyVersion,
          role: UserRole.USER,
          is_active: false,
        },
        select: { id_user: true },
      });

      return id_user;
    } catch (error) {
      if (isEmailAlreadyRegistered(error)) return null;

      throw error;
    }
  }

  async findByEmailHash(emailHash: string): Promise<AccountIdentity | null> {
    const user = await this.prisma.user.findUnique({
      where: { email_hash: emailHash },
      select: { id_user: true, user_name: true, is_active: true },
    });

    return user
      ? { id: user.id_user, name: user.user_name, isActive: user.is_active }
      : null;
  }

  async activate(userId: string, confirmedAt: Date): Promise<boolean> {
    // Condicionada à conta ainda inativa: confirmar de novo não reescreve a
    // data da primeira confirmação.
    const { count } = await this.prisma.user.updateMany({
      where: { id_user: userId, is_active: false },
      data: { is_active: true, email_confirmed_at: confirmedAt },
    });

    return count === 1;
  }

  async findCredentialsByEmailHash(
    emailHash: string,
  ): Promise<AccountCredentials | null> {
    const user = await this.prisma.user.findUnique({
      where: { email_hash: emailHash },
      select: {
        id_user: true,
        user_name: true,
        is_active: true,
        role: true,
        password_encrypted: true,
        encryption_key_version: true,
      },
    });

    return user
      ? {
          id: user.id_user,
          name: user.user_name,
          isActive: user.is_active,
          role: user.role,
          passwordEncrypted: user.password_encrypted,
          encryptionKeyVersion: user.encryption_key_version,
        }
      : null;
  }

  async findProfileById(userId: string): Promise<AccountProfile | null> {
    const user = await this.prisma.user.findUnique({
      where: { id_user: userId },
      select: {
        id_user: true,
        user_name: true,
        is_active: true,
        role: true,
        email_encrypted: true,
        address_encrypted: true,
        encryption_key_version: true,
      },
    });

    return user
      ? {
          id: user.id_user,
          name: user.user_name,
          isActive: user.is_active,
          role: user.role,
          emailEncrypted: user.email_encrypted,
          addressEncrypted: user.address_encrypted,
          encryptionKeyVersion: user.encryption_key_version,
        }
      : null;
  }

  async findSecretsById(userId: string): Promise<AccountSecrets | null> {
    const user = await this.prisma.user.findUnique({
      where: { id_user: userId },
      select: {
        password_encrypted: true,
        email_encrypted: true,
        address_encrypted: true,
        encryption_key_version: true,
      },
    });

    return user
      ? {
          passwordEncrypted: user.password_encrypted,
          emailEncrypted: user.email_encrypted,
          addressEncrypted: user.address_encrypted,
          encryptionKeyVersion: user.encryption_key_version,
        }
      : null;
  }

  async update(
    userId: string,
    {
      name,
      emailEncrypted,
      emailHash,
      emailConfirmedAt,
      passwordEncrypted,
      passwordChangedAt,
      addressEncrypted,
      encryptionKeyVersion,
    }: UserUpdate,
  ): Promise<UserUpdateOutcome> {
    try {
      const { count } = await this.prisma.user.updateMany({
        where: { id_user: userId },
        data: {
          user_name: name,
          email_encrypted: emailEncrypted,
          email_hash: emailHash,
          email_confirmed_at: emailConfirmedAt,
          password_encrypted: passwordEncrypted,
          password_changed_at: passwordChangedAt,
          address_encrypted: addressEncrypted,
          encryption_key_version: encryptionKeyVersion,
        },
      });

      return count === 1
        ? UserUpdateOutcome.UPDATED
        : UserUpdateOutcome.NOT_FOUND;
    } catch (error) {
      if (isEmailAlreadyRegistered(error)) return UserUpdateOutcome.EMAIL_TAKEN;

      throw error;
    }
  }

  async delete(userId: string): Promise<boolean> {
    return this.transaction(async (transaction) => {
      // Os registros de e-mails enviados guardam o hash do destinatário. A
      // relação só os desvincularia da conta; para a eliminação do titular
      // (LGPD) eles são apagados.
      await transaction.emailDispatchLog.deleteMany({
        where: { user_id: userId },
      });

      // As ações referenciais do schema (cascata em sessões, tokens, chaves de
      // API e bloqueios; anulação nas tentativas de login) são emuladas pelo
      // Prisma dentro desta mesma transação.
      const { count } = await transaction.user.deleteMany({
        where: { id_user: userId },
      });

      return count === 1;
    });
  }

  async recordLogin(userId: string, loggedInAt: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id_user: userId },
      data: { last_login_at: loggedInAt },
    });
  }
}

/** A criação falhou porque o índice único do e-mail já tem esse valor. */
function isEmailAlreadyRegistered(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}
