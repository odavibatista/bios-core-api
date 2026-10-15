import { Test } from '@nestjs/testing';
import { Prisma, SessionRevocationReason } from '@prisma/client';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { faker } from '@test/support/faker.js';
import type { NewUserSession } from '../../../domain/dtos/repositories/user-session.repository.js';
import { PrismaUserSessionRepository } from './prisma-user-session.repository.js';

describe('PrismaUserSessionRepository', () => {
  const create = vi.fn();
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const update = vi.fn();
  const transactionClient = {
    userSession: { updateMany, create, update },
  };
  const prisma = {
    userSession: { create, findUnique, updateMany, update },
    $transaction: vi.fn(
      (operation: (client: typeof transactionClient) => Promise<unknown>) =>
        operation(transactionClient),
    ),
  };
  let repository: PrismaUserSessionRepository;

  function buildSession(
    overrides: Partial<NewUserSession> = {},
  ): NewUserSession {
    return {
      userId: faker.database.mongodbObjectId(),
      familyId: faker.string.uuid(),
      refreshTokenHash: faker.string.hexadecimal({ length: 64, prefix: '' }),
      ip: faker.internet.ipv4(),
      userAgent: faker.internet.userAgent(),
      expiresAt: faker.date.future(),
      ...overrides,
    };
  }

  const notRevoked = {
    OR: [{ revoked_at: null }, { revoked_at: { isSet: false } }],
  };

  beforeEach(async () => {
    create.mockResolvedValue({
      id_user_session: faker.database.mongodbObjectId(),
    });
    updateMany.mockResolvedValue({ count: 1 });
    update.mockResolvedValue({});

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserSessionRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    repository = moduleRef.get(PrismaUserSessionRepository);
  });

  describe('create', () => {
    it('grava o elo só com o resumo do refresh token e devolve o identificador', async () => {
      const session = buildSession();
      const id = faker.database.mongodbObjectId();
      create.mockResolvedValue({ id_user_session: id });

      await expect(repository.create(session)).resolves.toBe(id);

      expect(create).toHaveBeenCalledWith({
        data: {
          user_id: session.userId,
          family_id: session.familyId,
          refresh_token_hash: session.refreshTokenHash,
          ip: session.ip,
          user_agent: session.userAgent,
          expires_at: session.expiresAt,
        },
        select: { id_user_session: true },
      });
    });

    it('aceita sessão sem user-agent', async () => {
      await repository.create(buildSession({ userAgent: undefined }));

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_agent: undefined }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('devolve o elo no formato do domínio', async () => {
      const stored = {
        id_user_session: faker.database.mongodbObjectId(),
        user_id: faker.database.mongodbObjectId(),
        family_id: faker.string.uuid(),
        expires_at: faker.date.future(),
        revoked_at: null,
        revocation_reason: null,
      };
      findUnique.mockResolvedValue(stored);

      await expect(
        repository.findById(stored.id_user_session),
      ).resolves.toEqual({
        id: stored.id_user_session,
        userId: stored.user_id,
        familyId: stored.family_id,
        expiresAt: stored.expires_at,
        revokedAt: null,
        revocationReason: null,
      });
      expect(findUnique).toHaveBeenCalledWith({
        where: { id_user_session: stored.id_user_session },
        select: {
          id_user_session: true,
          user_id: true,
          family_id: true,
          expires_at: true,
          revoked_at: true,
          revocation_reason: true,
        },
      });
    });

    it('devolve null quando o elo não existe', async () => {
      findUnique.mockResolvedValue(null);

      await expect(
        repository.findById(faker.database.mongodbObjectId()),
      ).resolves.toBeNull();
    });
  });

  describe('findByRefreshTokenHash', () => {
    it('devolve o elo no formato do domínio', async () => {
      const hash = faker.string.hexadecimal({ length: 64, prefix: '' });
      const stored = {
        id_user_session: faker.database.mongodbObjectId(),
        user_id: faker.database.mongodbObjectId(),
        family_id: faker.string.uuid(),
        expires_at: faker.date.future(),
        revoked_at: faker.date.recent(),
        revocation_reason: SessionRevocationReason.ROTATED,
      };
      findUnique.mockResolvedValue(stored);

      await expect(repository.findByRefreshTokenHash(hash)).resolves.toEqual({
        id: stored.id_user_session,
        userId: stored.user_id,
        familyId: stored.family_id,
        expiresAt: stored.expires_at,
        revokedAt: stored.revoked_at,
        revocationReason: SessionRevocationReason.ROTATED,
      });
      expect(findUnique).toHaveBeenCalledWith({
        where: { refresh_token_hash: hash },
        select: {
          id_user_session: true,
          user_id: true,
          family_id: true,
          expires_at: true,
          revoked_at: true,
          revocation_reason: true,
        },
      });
    });

    it('devolve null quando nenhum elo tem esse resumo', async () => {
      findUnique.mockResolvedValue(null);

      await expect(
        repository.findByRefreshTokenHash(faker.string.alphanumeric(64)),
      ).resolves.toBeNull();
    });
  });

  describe('rotate', () => {
    function buildRotation() {
      return {
        currentSessionId: faker.database.mongodbObjectId(),
        next: buildSession(),
        now: faker.date.recent(),
      };
    }

    it('revoga o elo atual como ROTATED só se ainda ativo e dentro da validade', async () => {
      const rotation = buildRotation();

      await repository.rotate(rotation);

      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id_user_session: rotation.currentSessionId,
          ...notRevoked,
          expires_at: { gt: rotation.now },
        },
        data: {
          revoked_at: rotation.now,
          revocation_reason: SessionRevocationReason.ROTATED,
        },
      });
    });

    it('cria o elo seguinte e aponta o anterior para ele', async () => {
      const rotation = buildRotation();
      const nextId = faker.database.mongodbObjectId();
      create.mockResolvedValue({ id_user_session: nextId });

      await expect(repository.rotate(rotation)).resolves.toBe(nextId);

      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_id: rotation.next.userId,
          family_id: rotation.next.familyId,
          refresh_token_hash: rotation.next.refreshTokenHash,
        }),
        select: { id_user_session: true },
      });
      expect(update).toHaveBeenCalledWith({
        where: { id_user_session: rotation.currentSessionId },
        data: { replaced_by_session_id: nextId },
      });
    });

    it('faz tudo na mesma transação', async () => {
      await repository.rotate(buildRotation());

      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });

    it('devolve null e não cria nada quando o elo já não estava ativo', async () => {
      updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.rotate(buildRotation())).resolves.toBeNull();

      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('devolve null quando perde a disputa por conflito de escrita', async () => {
      updateMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Write conflict', {
          code: 'P2034',
          clientVersion: faker.system.semver(),
        }),
      );

      await expect(repository.rotate(buildRotation())).resolves.toBeNull();
    });

    it('propaga qualquer outra falha do banco', async () => {
      updateMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Falha de conexão', {
          code: 'P1001',
          clientVersion: faker.system.semver(),
        }),
      );

      await expect(repository.rotate(buildRotation())).rejects.toThrow(
        'Falha de conexão',
      );
    });

    it('propaga erro que não é do Prisma', async () => {
      create.mockRejectedValue(new Error('inesperado'));

      await expect(repository.rotate(buildRotation())).rejects.toThrow(
        'inesperado',
      );
    });
  });

  describe('revokeFamily', () => {
    it('revoga só os elos ativos da família, com o motivo informado', async () => {
      const familyId = faker.string.uuid();
      const revokedAt = faker.date.recent();
      updateMany.mockResolvedValue({ count: 1 });

      await expect(
        repository.revokeFamily(
          familyId,
          SessionRevocationReason.LOGOUT,
          revokedAt,
        ),
      ).resolves.toBe(1);

      expect(updateMany).toHaveBeenCalledWith({
        where: { family_id: familyId, ...notRevoked },
        data: {
          revoked_at: revokedAt,
          revocation_reason: SessionRevocationReason.LOGOUT,
        },
      });
    });

    it('não procura por usuário: outras famílias do mesmo usuário ficam de fora', async () => {
      await repository.revokeFamily(
        faker.string.uuid(),
        SessionRevocationReason.LOGOUT,
        new Date(),
      );

      const [{ where }] = updateMany.mock.calls[0] as [{ where: object }];
      expect(where).not.toHaveProperty('user_id');
    });
  });

  describe('revokeAllActive', () => {
    it('revoga todos os elos ativos do usuário com o motivo informado', async () => {
      const userId = faker.database.mongodbObjectId();
      const revokedAt = faker.date.recent();
      updateMany.mockResolvedValue({ count: 4 });

      await expect(
        repository.revokeAllActive(
          userId,
          SessionRevocationReason.REUSE_DETECTED,
          revokedAt,
        ),
      ).resolves.toBe(4);

      expect(updateMany).toHaveBeenCalledWith({
        where: { user_id: userId, ...notRevoked },
        data: {
          revoked_at: revokedAt,
          revocation_reason: SessionRevocationReason.REUSE_DETECTED,
        },
      });
    });
  });
});
