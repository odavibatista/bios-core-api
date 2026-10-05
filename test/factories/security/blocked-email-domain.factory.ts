import { type BlockedEmailDomain, BlockedDomainOrigin } from '@prisma/client';
import { faker } from '../../support/faker.js';
import { defineFactory, timestamps } from '../factory.js';

/**
 * Domínio da blacklist de e-mail (`blocked_email_domains`), ativo. O
 * administrador responsável só é preenchido quando a origem é `ADMIN`.
 */
export const blockedEmailDomainFactory = defineFactory<BlockedEmailDomain>(
  () => {
    const origin = faker.helpers.objectValue(BlockedDomainOrigin);

    return {
      id_blocked_email_domain: faker.database.mongodbObjectId(),
      domain: faker.internet.domainName(),
      origin,
      created_by_user_id:
        origin === BlockedDomainOrigin.ADMIN
          ? faker.database.mongodbObjectId()
          : null,
      ...timestamps(),
      deleted_at: null,
    };
  },
);
