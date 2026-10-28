import { BlockedDomainOrigin, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { faker } from '@test/support/faker.js';
import {
  BlockedEmailDomainAlreadyExistsException,
  BlockedEmailDomainNotFoundException,
} from '../../domain/dtos/errors/blocked-email-domain-admin.errors.js';
import type {
  BlockedEmailDomainRecord,
  BlockedEmailDomainRepository,
} from '../../domain/dtos/repositories/blocked-email-domain.repository.js';
import { AddBlockedEmailDomainUseCase } from './add-blocked-email-domain.usecase.js';
import { ListBlockedEmailDomainsUseCase } from './list-blocked-email-domains.usecase.js';
import { RemoveBlockedEmailDomainUseCase } from './remove-blocked-email-domain.usecase.js';

function recordOf(
  overrides: Partial<BlockedEmailDomainRecord> = {},
): BlockedEmailDomainRecord {
  return {
    id: faker.database.mongodbObjectId(),
    domain: faker.internet.domainName(),
    origin: faker.helpers.objectValue(BlockedDomainOrigin),
    createdAt: faker.date.past(),
    ...overrides,
  };
}

describe('manutenção da blacklist pelo administrador (UC13)', () => {
  const repository = {
    isBlocked: vi.fn<BlockedEmailDomainRepository['isBlocked']>(),
    listActive: vi.fn<BlockedEmailDomainRepository['listActive']>(),
    add: vi.fn<BlockedEmailDomainRepository['add']>(),
    remove: vi.fn<BlockedEmailDomainRepository['remove']>(),
  };
  const admin: AuthenticatedUser = {
    userId: faker.database.mongodbObjectId(),
    sessionId: faker.database.mongodbObjectId(),
    familyId: faker.database.mongodbObjectId(),
    role: UserRole.ADMIN,
  };

  describe('ListBlockedEmailDomainsUseCase', () => {
    const useCase = new ListBlockedEmailDomainsUseCase(repository);

    it('pede a página certa e devolve os itens no formato da API, com a paginação', async () => {
      const records = [recordOf(), recordOf()];
      repository.listActive.mockResolvedValue({ items: records, total: 12 });

      const page = await useCase.execute({ page: 3, page_size: 5 });

      expect(repository.listActive).toHaveBeenCalledWith({ skip: 10, take: 5 });
      expect(page).toEqual({
        data: records.map((record) => ({
          id: record.id,
          domain: record.domain,
          origin: record.origin,
          created_at: record.createdAt.toISOString(),
        })),
        pagination: { page: 3, page_size: 5, total: 12, total_pages: 3 },
      });
    });
  });

  describe('AddBlockedEmailDomainUseCase', () => {
    const useCase = new AddBlockedEmailDomainUseCase(repository);
    const domain = faker.internet.domainName();

    it.each(['ADDED', 'RESTORED'] as const)(
      'grava em nome do administrador e devolve o domínio (%s)',
      async (outcome) => {
        const record = recordOf({ domain, origin: BlockedDomainOrigin.ADMIN });
        repository.add.mockResolvedValue({ outcome, record });

        await expect(
          useCase.execute({ user: admin, request: { domain } }),
        ).resolves.toEqual({
          id: record.id,
          domain,
          origin: BlockedDomainOrigin.ADMIN,
          created_at: record.createdAt.toISOString(),
        });
        expect(repository.add).toHaveBeenCalledWith(domain, admin.userId);
      },
    );

    it('domínio já bloqueado: 409 (fluxo 4.1)', async () => {
      repository.add.mockResolvedValue({ outcome: 'ALREADY_BLOCKED' });

      await expect(
        useCase.execute({ user: admin, request: { domain } }),
      ).rejects.toBeInstanceOf(BlockedEmailDomainAlreadyExistsException);
    });
  });

  describe('RemoveBlockedEmailDomainUseCase', () => {
    const useCase = new RemoveBlockedEmailDomainUseCase(repository);

    it('remove logicamente, com a data da remoção', async () => {
      const id = faker.database.mongodbObjectId();
      repository.remove.mockResolvedValue(true);

      await useCase.execute(id);

      expect(repository.remove).toHaveBeenCalledWith(id, expect.any(Date));
    });

    it('inexistente ou já removido: 404', async () => {
      repository.remove.mockResolvedValue(false);

      await expect(
        useCase.execute(faker.database.mongodbObjectId()),
      ).rejects.toBeInstanceOf(BlockedEmailDomainNotFoundException);
    });

    it.each(['nao-e-objectid', '123', `${'a'.repeat(24)}x`])(
      'identificador malformado (%s): 404 sem consultar o banco',
      async (id) => {
        await expect(useCase.execute(id)).rejects.toBeInstanceOf(
          BlockedEmailDomainNotFoundException,
        );
        expect(repository.remove).not.toHaveBeenCalled();
      },
    );
  });
});
