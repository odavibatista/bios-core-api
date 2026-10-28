import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { REQUIRED_ROLES } from '@shared/http/decorators/roles.decorator.js';
import { faker } from '@test/support/faker.js';
import type { AddBlockedEmailDomainUseCase } from '../../infra/usecases/add-blocked-email-domain.usecase.js';
import type { ListBlockedEmailDomainsUseCase } from '../../infra/usecases/list-blocked-email-domains.usecase.js';
import type { RemoveBlockedEmailDomainUseCase } from '../../infra/usecases/remove-blocked-email-domain.usecase.js';
import { BlockedEmailDomainsController } from './blocked-email-domains.controller.js';

describe('BlockedEmailDomainsController', () => {
  const list = { execute: vi.fn<ListBlockedEmailDomainsUseCase['execute']>() };
  const add = { execute: vi.fn<AddBlockedEmailDomainUseCase['execute']>() };
  const remove = {
    execute: vi.fn<RemoveBlockedEmailDomainUseCase['execute']>(),
  };
  const controller = new BlockedEmailDomainsController(
    list as unknown as ListBlockedEmailDomainsUseCase,
    add as unknown as AddBlockedEmailDomainUseCase,
    remove as unknown as RemoveBlockedEmailDomainUseCase,
  );
  const user: AuthenticatedUser = {
    userId: faker.database.mongodbObjectId(),
    sessionId: faker.database.mongodbObjectId(),
    familyId: faker.database.mongodbObjectId(),
    role: UserRole.ADMIN,
  };

  it('é exclusivo de ADMIN ([P12])', () => {
    expect(
      new Reflector().get<UserRole[]>(
        REQUIRED_ROLES,
        BlockedEmailDomainsController,
      ),
    ).toEqual([UserRole.ADMIN]);
  });

  it('lista com a paginação pedida', async () => {
    const page = {
      data: [],
      pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 },
    };
    list.execute.mockResolvedValue(page);

    await expect(controller.list({ page: 1, page_size: 20 })).resolves.toBe(
      page,
    );
  });

  it('inclui em nome do administrador da sessão', async () => {
    const domain = faker.internet.domainName();

    await controller.add({ domain }, user);

    expect(add.execute).toHaveBeenCalledWith({ user, request: { domain } });
  });

  it('remove pelo identificador', async () => {
    const id = faker.database.mongodbObjectId();

    await controller.remove(id);

    expect(remove.execute).toHaveBeenCalledWith(id);
  });
});
