import type { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { PasswordProvider } from '@shared/domain/providers/password.provider.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { buildPassword } from '../factories/shared/password.factory.js';
import { faker } from './faker.js';

/** Conta gravada para um teste, com as credenciais em claro. */
export interface TestAccount {
  id: string;
  email: string;
  password: string;
}

/**
 * Grava uma conta como o cadastro grava — e-mail cifrado, índice cego, senha
 * em duas camadas e os campos opcionais ausentes —, já confirmada ou não.
 */
export async function createTestAccount(
  app: INestApplication,
  {
    active = true,
    role = UserRole.USER,
  }: { active?: boolean; role?: UserRole } = {},
): Promise<TestAccount> {
  const prisma = app.get(PrismaService);
  const encryption = app.get(EncryptionProvider);
  const passwords = app.get(PasswordProvider);
  const email = faker.internet.email().toLowerCase();
  const password = buildPassword();
  const emailEncrypted = encryption.encrypt(email);
  const passwordEncrypted = await passwords.hash(password);

  const { id_user } = await prisma.user.create({
    data: {
      user_name: faker.person.fullName(),
      email_encrypted: emailEncrypted.ciphertext,
      email_hash: encryption.blindIndex(email),
      password_encrypted: passwordEncrypted.ciphertext,
      encryption_key_version: emailEncrypted.keyVersion,
      role,
      is_active: active,
    },
  });

  return { id: id_user, email, password };
}
