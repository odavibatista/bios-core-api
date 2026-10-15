import { type UserToken, UserTokenPurpose } from '@prisma/client';
import { faker } from '../../support/faker.js';
import { defineFactory, timestamps } from '../factory.js';

/**
 * Token de uso único (`user_tokens`), válido e ainda não usado. Os campos de
 * troca de e-mail só são preenchidos quando a finalidade é `EMAIL_CHANGE`.
 */
export const userTokenFactory = defineFactory<UserToken>(() => {
  const purpose = faker.helpers.objectValue(UserTokenPurpose);

  return {
    id_user_token: faker.database.mongodbObjectId(),
    user_id: faker.database.mongodbObjectId(),
    purpose,
    token_hash: faker.string.hexadecimal({
      length: 64,
      casing: 'lower',
      prefix: '',
    }),
    pending_email_encrypted:
      purpose === UserTokenPurpose.EMAIL_CHANGE
        ? faker.string.alphanumeric(64)
        : null,
    expires_at: faker.date.soon({ days: 1 }),
    used_at: null,
    ...timestamps(),
  };
});
