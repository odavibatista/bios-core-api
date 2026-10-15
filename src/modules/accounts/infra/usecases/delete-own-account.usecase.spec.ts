import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { PasswordProvider } from '@shared/domain/providers/password.provider.js';
import { buildPassword } from '@test/factories/shared/password.factory.js';
import { faker } from '@test/support/faker.js';
import { AccountNotFoundException } from '../../domain/dtos/errors/account-not-found.exception.js';
import { InvalidCurrentPasswordException } from '../../domain/dtos/errors/invalid-current-password.exception.js';
import { UserRepository } from '../../domain/dtos/repositories/user.repository.js';
import { DeleteOwnAccountUseCase } from './delete-own-account.usecase.js';

describe('DeleteOwnAccountUseCase', () => {
  const userRepository = {
    findSecretsById: vi.fn<UserRepository['findSecretsById']>(),
    delete: vi.fn<UserRepository['delete']>(),
  };
  const passwordProvider = { verify: vi.fn<PasswordProvider['verify']>() };
  const secrets = {
    passwordEncrypted: faker.string.alphanumeric(60),
    emailEncrypted: faker.string.alphanumeric(40),
    addressEncrypted: null,
    encryptionKeyVersion: 3,
  };
  const user: AuthenticatedUser = {
    userId: faker.database.mongodbObjectId(),
    sessionId: faker.database.mongodbObjectId(),
    familyId: faker.string.uuid(),
    role: UserRole.USER,
  };
  let useCase: DeleteOwnAccountUseCase;

  beforeEach(async () => {
    userRepository.findSecretsById.mockResolvedValue(secrets);
    userRepository.delete.mockResolvedValue(true);
    passwordProvider.verify.mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({
      providers: [
        DeleteOwnAccountUseCase,
        { provide: UserRepository, useValue: userRepository },
        { provide: PasswordProvider, useValue: passwordProvider },
      ],
    }).compile();

    useCase = moduleRef.get(DeleteOwnAccountUseCase);
  });

  it('exclui a conta quando a senha confere', async () => {
    const request = { password: buildPassword() };

    await expect(useCase.execute({ user, request })).resolves.toBeUndefined();

    expect(passwordProvider.verify).toHaveBeenCalledWith(request.password, {
      ciphertext: secrets.passwordEncrypted,
      keyVersion: 3,
    });
    expect(userRepository.delete).toHaveBeenCalledWith(user.userId);
  });

  describe('senha incorreta', () => {
    beforeEach(() => {
      passwordProvider.verify.mockResolvedValue(false);
    });

    it('recusa', async () => {
      await expect(
        useCase.execute({ user, request: { password: buildPassword() } }),
      ).rejects.toBeInstanceOf(InvalidCurrentPasswordException);
    });

    it('não exclui nada', async () => {
      await useCase
        .execute({ user, request: { password: buildPassword() } })
        .catch(() => undefined);

      expect(userRepository.delete).not.toHaveBeenCalled();
    });
  });

  it('recusa quando a conta da sessão não existe mais', async () => {
    userRepository.findSecretsById.mockResolvedValue(null);

    await expect(
      useCase.execute({ user, request: { password: buildPassword() } }),
    ).rejects.toBeInstanceOf(AccountNotFoundException);

    expect(passwordProvider.verify).not.toHaveBeenCalled();
    expect(userRepository.delete).not.toHaveBeenCalled();
  });

  it('recusa quando a conta some entre a conferência e a exclusão', async () => {
    userRepository.delete.mockResolvedValue(false);

    await expect(
      useCase.execute({ user, request: { password: buildPassword() } }),
    ).rejects.toBeInstanceOf(AccountNotFoundException);
  });

  it('propaga a falha do banco, para que a exclusão não pareça concluída', async () => {
    userRepository.delete.mockRejectedValue(new Error('banco fora'));

    await expect(
      useCase.execute({ user, request: { password: buildPassword() } }),
    ).rejects.toThrow('banco fora');
  });
});
