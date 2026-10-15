import { Test } from '@nestjs/testing';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { faker } from '@test/support/faker.js';
import type { NewUser } from '../../../domain/dtos/repositories/user.repository.js';
import { PrismaUserRepository } from './prisma-user.repository.js';

describe('PrismaUserRepository', () => {
  const create = vi.fn();
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const update = vi.fn();
  let repository: PrismaUserRepository;

  function buildNewUser(): NewUser {
    return {
      name: faker.person.fullName(),
      emailEncrypted: faker.string.alphanumeric(40),
      emailHash: faker.string.hexadecimal({ length: 64, prefix: '' }),
      passwordEncrypted: faker.string.alphanumeric(60),
      encryptionKeyVersion: faker.number.int({ min: 1, max: 5 }),
    };
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { user: { create, findUnique, updateMany, update } },
        },
      ],
    }).compile();

    repository = moduleRef.get(PrismaUserRepository);
  });

  describe('createInactive', () => {
    it('grava a conta inativa, com papel USER, e devolve o identificador', async () => {
      const user = buildNewUser();
      const id = faker.database.mongodbObjectId();
      create.mockResolvedValue({ id_user: id });

      await expect(repository.createInactive(user)).resolves.toBe(id);

      expect(create).toHaveBeenCalledWith({
        data: {
          user_name: user.name,
          email_encrypted: user.emailEncrypted,
          email_hash: user.emailHash,
          password_encrypted: user.passwordEncrypted,
          encryption_key_version: user.encryptionKeyVersion,
          role: UserRole.USER,
          is_active: false,
        },
        select: { id_user: true },
      });
    });

    it('devolve null quando o índice único do e-mail já tem esse valor', async () => {
      create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: faker.system.semver(),
        }),
      );

      await expect(
        repository.createInactive(buildNewUser()),
      ).resolves.toBeNull();
    });

    it('propaga qualquer outra falha do banco', async () => {
      create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Falha de conexão', {
          code: 'P1001',
          clientVersion: faker.system.semver(),
        }),
      );

      await expect(repository.createInactive(buildNewUser())).rejects.toThrow(
        'Falha de conexão',
      );
    });

    it('propaga erro que não é do Prisma', async () => {
      create.mockRejectedValue(new Error('inesperado'));

      await expect(repository.createInactive(buildNewUser())).rejects.toThrow(
        'inesperado',
      );
    });
  });

  describe('findByEmailHash', () => {
    it('devolve só o que o fluxo de confirmação precisa', async () => {
      const emailHash = faker.string.hexadecimal({ length: 64, prefix: '' });
      const user = {
        id_user: faker.database.mongodbObjectId(),
        user_name: faker.person.fullName(),
        is_active: false,
      };
      findUnique.mockResolvedValue(user);

      await expect(repository.findByEmailHash(emailHash)).resolves.toEqual({
        id: user.id_user,
        name: user.user_name,
        isActive: false,
      });
      expect(findUnique).toHaveBeenCalledWith({
        where: { email_hash: emailHash },
        select: { id_user: true, user_name: true, is_active: true },
      });
    });

    it('devolve null quando não há conta com o e-mail', async () => {
      findUnique.mockResolvedValue(null);

      await expect(
        repository.findByEmailHash(faker.string.alphanumeric(64)),
      ).resolves.toBeNull();
    });
  });

  describe('activate', () => {
    it('ativa só a conta ainda inativa e registra a confirmação', async () => {
      const userId = faker.database.mongodbObjectId();
      const confirmedAt = faker.date.recent();
      updateMany.mockResolvedValue({ count: 1 });

      await expect(repository.activate(userId, confirmedAt)).resolves.toBe(
        true,
      );

      expect(updateMany).toHaveBeenCalledWith({
        where: { id_user: userId, is_active: false },
        data: { is_active: true, email_confirmed_at: confirmedAt },
      });
    });

    it('devolve false quando não há conta inativa com o identificador', async () => {
      updateMany.mockResolvedValue({ count: 0 });

      await expect(
        repository.activate(faker.database.mongodbObjectId(), new Date()),
      ).resolves.toBe(false);
    });
  });

  describe('findCredentialsByEmailHash', () => {
    it('devolve o que a autenticação precisa para conferir a senha', async () => {
      const emailHash = faker.string.hexadecimal({ length: 64, prefix: '' });
      const user = {
        id_user: faker.database.mongodbObjectId(),
        user_name: faker.person.fullName(),
        is_active: true,
        role: UserRole.ADMIN,
        password_encrypted: faker.string.alphanumeric(60),
        encryption_key_version: 2,
      };
      findUnique.mockResolvedValue(user);

      await expect(
        repository.findCredentialsByEmailHash(emailHash),
      ).resolves.toEqual({
        id: user.id_user,
        name: user.user_name,
        isActive: true,
        role: UserRole.ADMIN,
        passwordEncrypted: user.password_encrypted,
        encryptionKeyVersion: 2,
      });
      expect(findUnique).toHaveBeenCalledWith({
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
    });

    it('devolve null quando não há conta com o e-mail', async () => {
      findUnique.mockResolvedValue(null);

      await expect(
        repository.findCredentialsByEmailHash(faker.string.alphanumeric(64)),
      ).resolves.toBeNull();
    });
  });

  describe('findProfileById', () => {
    it('devolve o papel vigente e o e-mail cifrado da conta', async () => {
      const user = {
        id_user: faker.database.mongodbObjectId(),
        user_name: faker.person.fullName(),
        is_active: true,
        role: UserRole.ADMIN,
        email_encrypted: faker.string.alphanumeric(40),
        encryption_key_version: 2,
      };
      findUnique.mockResolvedValue(user);

      await expect(repository.findProfileById(user.id_user)).resolves.toEqual({
        id: user.id_user,
        name: user.user_name,
        isActive: true,
        role: UserRole.ADMIN,
        emailEncrypted: user.email_encrypted,
        encryptionKeyVersion: 2,
      });
      expect(findUnique).toHaveBeenCalledWith({
        where: { id_user: user.id_user },
        select: {
          id_user: true,
          user_name: true,
          is_active: true,
          role: true,
          email_encrypted: true,
          encryption_key_version: true,
        },
      });
    });

    it('devolve null quando a conta não existe', async () => {
      findUnique.mockResolvedValue(null);

      await expect(
        repository.findProfileById(faker.database.mongodbObjectId()),
      ).resolves.toBeNull();
    });
  });

  describe('recordLogin', () => {
    it('grava a data do último login da conta', async () => {
      const userId = faker.database.mongodbObjectId();
      const loggedInAt = faker.date.recent();
      update.mockResolvedValue({});

      await repository.recordLogin(userId, loggedInAt);

      expect(update).toHaveBeenCalledWith({
        where: { id_user: userId },
        data: { last_login_at: loggedInAt },
      });
    });
  });
});
