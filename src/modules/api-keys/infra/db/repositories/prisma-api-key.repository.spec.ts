import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { faker } from '@test/support/faker.js';
import { PrismaApiKeyRepository } from './prisma-api-key.repository.js';

describe('PrismaApiKeyRepository', () => {
  const create = vi.fn();
  const count = vi.fn();
  const findMany = vi.fn();
  const findFirst = vi.fn();
  const updateMany = vi.fn();
  let repository: PrismaApiKeyRepository;

  const notRevoked = {
    OR: [{ revoked_at: null }, { revoked_at: { isSet: false } }],
  };
  const fields = {
    id_api_key: true,
    key_name: true,
    key_prefix: true,
    created_at: true,
    last_used_at: true,
  };

  function buildDocument(overrides: Record<string, unknown> = {}) {
    return {
      id_api_key: faker.database.mongodbObjectId(),
      key_name: faker.commerce.productName(),
      key_prefix: `bios_${faker.string.alphanumeric(8)}`,
      created_at: faker.date.past(),
      last_used_at: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaApiKeyRepository,
        {
          provide: PrismaService,
          useValue: {
            apiKey: { create, count, findMany, findFirst, updateMany },
          },
        },
      ],
    }).compile();

    repository = moduleRef.get(PrismaApiKeyRepository);
  });

  describe('create', () => {
    const newKey = () => ({
      userId: faker.database.mongodbObjectId(),
      name: 'Integração',
      prefix: `bios_${faker.string.alphanumeric(8)}`,
      hash: faker.string.hexadecimal({ length: 64, prefix: '' }),
    });

    it('grava só o resumo e o prefixo, sem campo para o valor da chave', async () => {
      const key = newKey();
      create.mockResolvedValue(buildDocument());

      await repository.create(key);

      expect(create).toHaveBeenCalledWith({
        data: {
          user_id: key.userId,
          key_name: key.name,
          key_prefix: key.prefix,
          key_hash: key.hash,
        },
        select: fields,
      });
    });

    it('devolve a chave no formato do domínio, sem o resumo', async () => {
      const document = buildDocument();
      create.mockResolvedValue(document);

      const created = await repository.create(newKey());

      expect(created).toEqual({
        id: document.id_api_key,
        name: document.key_name,
        prefix: document.key_prefix,
        createdAt: document.created_at,
        lastUsedAt: null,
      });
    });

    it('devolve null quando o prefixo ou o resumo já existem', async () => {
      create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: faker.system.semver(),
        }),
      );

      await expect(repository.create(newKey())).resolves.toBeNull();
    });

    it('propaga qualquer outra falha do banco', async () => {
      create.mockRejectedValue(new Error('banco fora'));

      await expect(repository.create(newKey())).rejects.toThrow('banco fora');
    });
  });

  describe('countActive', () => {
    it('conta só as chaves do usuário ainda não revogadas', async () => {
      const userId = faker.database.mongodbObjectId();
      count.mockResolvedValue(4);

      await expect(repository.countActive(userId)).resolves.toBe(4);

      expect(count).toHaveBeenCalledWith({
        where: { user_id: userId, ...notRevoked },
      });
    });
  });

  describe('listActive', () => {
    it('lista as ativas do usuário, da mais nova para a mais antiga, sem o resumo', async () => {
      const userId = faker.database.mongodbObjectId();
      findMany.mockResolvedValue([]);

      await repository.listActive(userId);

      expect(findMany).toHaveBeenCalledWith({
        where: { user_id: userId, ...notRevoked },
        orderBy: { created_at: 'desc' },
        select: fields,
      });
    });

    it('converte os documentos para o formato do domínio', async () => {
      const used = buildDocument({ last_used_at: faker.date.recent() });
      findMany.mockResolvedValue([used]);

      await expect(
        repository.listActive(faker.database.mongodbObjectId()),
      ).resolves.toEqual([
        {
          id: used.id_api_key,
          name: used.key_name,
          prefix: used.key_prefix,
          createdAt: used.created_at,
          lastUsedAt: used.last_used_at,
        },
      ]);
    });
  });

  describe('revoke', () => {
    it('revoga só se a chave é do usuário e ainda está ativa', async () => {
      const userId = faker.database.mongodbObjectId();
      const apiKeyId = faker.database.mongodbObjectId();
      const revokedAt = faker.date.recent();
      updateMany.mockResolvedValue({ count: 1 });

      await expect(
        repository.revoke(userId, apiKeyId, revokedAt),
      ).resolves.toBe(true);

      expect(updateMany).toHaveBeenCalledWith({
        where: { id_api_key: apiKeyId, user_id: userId, ...notRevoked },
        data: { revoked_at: revokedAt },
      });
    });

    it('devolve false quando nada foi revogado', async () => {
      updateMany.mockResolvedValue({ count: 0 });

      await expect(
        repository.revoke(
          faker.database.mongodbObjectId(),
          faker.database.mongodbObjectId(),
          new Date(),
        ),
      ).resolves.toBe(false);
    });
  });

  describe('findActiveByPrefix', () => {
    it('busca pelo prefixo entre as chaves não revogadas, trazendo só o necessário para conferir', async () => {
      const prefix = `bios_${faker.string.alphanumeric(8)}`;
      findFirst.mockResolvedValue(null);

      await repository.findActiveByPrefix(prefix);

      expect(findFirst).toHaveBeenCalledWith({
        where: { key_prefix: prefix, ...notRevoked },
        select: { id_api_key: true, user_id: true, key_hash: true },
      });
    });

    it('converte o documento para a credencial do domínio', async () => {
      const document = {
        id_api_key: faker.database.mongodbObjectId(),
        user_id: faker.database.mongodbObjectId(),
        key_hash: faker.string.hexadecimal({ length: 64, prefix: '' }),
      };
      findFirst.mockResolvedValue(document);

      await expect(repository.findActiveByPrefix('bios_x')).resolves.toEqual({
        id: document.id_api_key,
        userId: document.user_id,
        hash: document.key_hash,
      });
    });

    it('devolve null quando não há chave ativa com o prefixo', async () => {
      findFirst.mockResolvedValue(null);

      await expect(repository.findActiveByPrefix('bios_x')).resolves.toBeNull();
    });
  });

  describe('markUsed', () => {
    it('grava o uso só se o último registrado é anterior ao limite, ou não existe', async () => {
      const apiKeyId = faker.database.mongodbObjectId();
      const usedAt = faker.date.recent();
      const staleBefore = faker.date.past();
      updateMany.mockResolvedValue({ count: 1 });

      await repository.markUsed(apiKeyId, usedAt, staleBefore);

      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id_api_key: apiKeyId,
          OR: [
            { last_used_at: null },
            { last_used_at: { isSet: false } },
            { last_used_at: { lt: staleBefore } },
          ],
        },
        data: { last_used_at: usedAt },
      });
    });

    it('não é erro quando o uso recente dispensa a gravação', async () => {
      updateMany.mockResolvedValue({ count: 0 });

      await expect(
        repository.markUsed(
          faker.database.mongodbObjectId(),
          new Date(),
          faker.date.past(),
        ),
      ).resolves.toBeUndefined();
    });
  });
});
