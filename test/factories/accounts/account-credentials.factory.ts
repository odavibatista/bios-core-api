import { UserRole } from '@prisma/client';
import type { AccountCredentials } from '@modules/accounts/domain/dtos/repositories/user.repository.js';
import { faker } from '../../support/faker.js';
import { defineFactory } from '../factory.js';

/** Conta ativa, com tudo que a autenticação lê para conferir a senha. */
export const accountCredentialsFactory = defineFactory<AccountCredentials>(
  () => ({
    id: faker.database.mongodbObjectId(),
    name: faker.person.fullName(),
    isActive: true,
    role: faker.helpers.objectValue(UserRole),
    passwordEncrypted: faker.string.alphanumeric(60),
    encryptionKeyVersion: faker.number.int({ min: 1, max: 5 }),
  }),
);
