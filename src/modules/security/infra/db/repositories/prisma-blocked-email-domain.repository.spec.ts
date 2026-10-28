import { Test } from '@nestjs/testing';
import { BlockedDomainOrigin, Prisma } from '@prisma/client';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { blockedEmailDomainFactory } from '@test/factories/security/blocked-email-domain.factory.js';
import { faker } from '@test/support/faker.js';
import { PrismaBlockedEmailDomainRepository } from './prisma-blocked-email-domain.repository.js';

const NOT_DELETED = {
  OR: [{ deleted_at: null }, { deleted_at: { isSet: false } }],
};
const RECORD_FIELDS = {
  id_blocked_email_domain: true,
  domain: true,
  origin: true,
  created_at: true,
};

describe('PrismaBlockedEmailDomainRepository', () => {
  const findFirst =
    vi.fn<() => Promise<{ id_blocked_email_domain: string } | null>>();
  const findMany = vi.fn();
  const count = vi.fn();
  const findUnique = vi.fn();
  const findUniqueOrThrow = vi.fn();
  const updateMany = vi.fn();
  const create = vi.fn();
  let repository: PrismaBlockedEmailDomainRepository;

  /** Linha como o `select` de `RECORD_FIELDS` a devolve. */
  const rowOf = (row: ReturnType<typeof blockedEmailDomainFactory.build>) => ({
    id_blocked_email_domain: row.id_blocked_email_domain,
    domain: row.domain,
    origin: row.origin,
    created_at: row.created_at,
  });

  beforeEach(async () => {
    findFirst.mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaBlockedEmailDomainRepository,
        {
          provide: PrismaService,
          useValue: {
            blockedEmailDomain: {
              findFirst,
              findMany,
              count,
              findUnique,
              findUniqueOrThrow,
              updateMany,
              create,
            },
          },
        },
      ],
    }).compile();

    repository = moduleRef.get(PrismaBlockedEmailDomainRepository);
  });

  describe('isBlocked', () => {
    it('procura o domínio exato, ignorando os removidos logicamente', async () => {
      const domain = faker.internet.domainName();

      await repository.isBlocked(domain);

      expect(findFirst).toHaveBeenCalledWith({
        where: { domain, ...NOT_DELETED },
        select: { id_blocked_email_domain: true },
      });
    });

    it('reporta bloqueado quando há registro ativo', async () => {
      findFirst.mockResolvedValue(blockedEmailDomainFactory.build());

      await expect(
        repository.isBlocked(faker.internet.domainName()),
      ).resolves.toBe(true);
    });

    it('reporta liberado quando não há registro', async () => {
      findFirst.mockResolvedValue(null);

      await expect(
        repository.isBlocked(faker.internet.domainName()),
      ).resolves.toBe(false);
    });
  });

  describe('listActive (UC13, fluxo 2)', () => {
    it('lê só os ativos, em ordem alfabética, na página pedida, e conta os ativos', async () => {
      const rows = blockedEmailDomainFactory.buildMany(2);
      findMany.mockResolvedValue(rows.map(rowOf));
      count.mockResolvedValue(7);

      const page = await repository.listActive({ skip: 4, take: 2 });

      expect(findMany).toHaveBeenCalledWith({
        where: NOT_DELETED,
        orderBy: { domain: 'asc' },
        skip: 4,
        take: 2,
        select: RECORD_FIELDS,
      });
      expect(count).toHaveBeenCalledWith({ where: NOT_DELETED });
      expect(page).toEqual({
        total: 7,
        items: rows.map((row) => ({
          id: row.id_blocked_email_domain,
          domain: row.domain,
          origin: row.origin,
          createdAt: row.created_at,
        })),
      });
    });
  });

  describe('add (UC13, fluxos 3 e 4)', () => {
    const domain = faker.internet.domainName();
    const userId = faker.database.mongodbObjectId();

    it('domínio novo: grava com origem ADMIN e o administrador responsável', async () => {
      const row = blockedEmailDomainFactory.build({
        domain,
        origin: BlockedDomainOrigin.ADMIN,
      });
      findUnique.mockResolvedValue(null);
      create.mockResolvedValue(rowOf(row));

      const result = await repository.add(domain, userId);

      expect(create).toHaveBeenCalledWith({
        data: {
          domain,
          origin: BlockedDomainOrigin.ADMIN,
          created_by_user_id: userId,
        },
        select: RECORD_FIELDS,
      });
      expect(result).toEqual({
        outcome: 'ADDED',
        record: {
          id: row.id_blocked_email_domain,
          domain,
          origin: BlockedDomainOrigin.ADMIN,
          createdAt: row.created_at,
        },
      });
    });

    it('domínio já bloqueado: nada é gravado', async () => {
      findUnique.mockResolvedValue({
        id_blocked_email_domain: faker.database.mongodbObjectId(),
        deleted_at: null,
      });

      await expect(repository.add(domain, userId)).resolves.toEqual({
        outcome: 'ALREADY_BLOCKED',
      });
      expect(create).not.toHaveBeenCalled();
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('domínio removido: restaura o mesmo registro em nome do administrador, sem duplicar (RF29)', async () => {
      const row = blockedEmailDomainFactory.build({
        domain,
        origin: BlockedDomainOrigin.ADMIN,
      });
      findUnique.mockResolvedValue({
        id_blocked_email_domain: row.id_blocked_email_domain,
        deleted_at: faker.date.past(),
      });
      updateMany.mockResolvedValue({ count: 1 });
      findUniqueOrThrow.mockResolvedValue(rowOf(row));

      const result = await repository.add(domain, userId);

      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id_blocked_email_domain: row.id_blocked_email_domain,
          deleted_at: { not: null },
        },
        data: {
          deleted_at: null,
          origin: BlockedDomainOrigin.ADMIN,
          created_by_user_id: userId,
        },
      });
      expect(create).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        outcome: 'RESTORED',
        record: { id: row.id_blocked_email_domain, domain },
      });
    });

    it('outra reinclusão restaurou antes: responde já bloqueado', async () => {
      findUnique.mockResolvedValue({
        id_blocked_email_domain: faker.database.mongodbObjectId(),
        deleted_at: faker.date.past(),
      });
      updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.add(domain, userId)).resolves.toEqual({
        outcome: 'ALREADY_BLOCKED',
      });
      expect(findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('outra inclusão do mesmo domínio novo chegou antes (índice único): responde já bloqueado', async () => {
      findUnique.mockResolvedValue(null);
      create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicado', {
          code: 'P2002',
          clientVersion: 'teste',
        }),
      );

      await expect(repository.add(domain, userId)).resolves.toEqual({
        outcome: 'ALREADY_BLOCKED',
      });
    });

    it('propaga a falha do banco que não é de índice único', async () => {
      findUnique.mockResolvedValue(null);
      create.mockRejectedValue(new Error('banco fora'));

      await expect(repository.add(domain, userId)).rejects.toThrow(
        'banco fora',
      );
    });
  });

  describe('remove (UC13, fluxo 3.1)', () => {
    it('remoção lógica, só se ainda estiver ativo', async () => {
      const id = faker.database.mongodbObjectId();
      const removedAt = faker.date.recent();
      updateMany.mockResolvedValue({ count: 1 });

      await expect(repository.remove(id, removedAt)).resolves.toBe(true);
      expect(updateMany).toHaveBeenCalledWith({
        where: { id_blocked_email_domain: id, ...NOT_DELETED },
        data: { deleted_at: removedAt },
      });
    });

    it('inexistente ou já removido: false', async () => {
      updateMany.mockResolvedValue({ count: 0 });

      await expect(
        repository.remove(faker.database.mongodbObjectId(), new Date()),
      ).resolves.toBe(false);
    });
  });
});
