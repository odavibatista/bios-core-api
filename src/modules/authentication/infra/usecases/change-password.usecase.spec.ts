import { Test } from '@nestjs/testing';
import { SessionRevocationReason, UserRole } from '@prisma/client';
import { UserRepository } from '@modules/accounts/domain/dtos/repositories/user.repository.js';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { PasswordProvider } from '@shared/domain/providers/password.provider.js';
import { buildPassword } from '@test/factories/shared/password.factory.js';
import { faker } from '@test/support/faker.js';
import { InvalidCurrentPasswordException } from '../../domain/dtos/errors/invalid-current-password.exception.js';
import { NotAuthenticatedException } from '../../domain/dtos/errors/not-authenticated.exception.js';
import { PasswordUnchangedException } from '../../domain/dtos/errors/password-unchanged.exception.js';
import { ChangePasswordUseCase } from './change-password.usecase.js';
import { ReplacePasswordUseCase } from './replace-password.usecase.js';

describe('ChangePasswordUseCase', () => {
  const userRepository = {
    findSecretsById: vi.fn<UserRepository['findSecretsById']>(),
  };
  const passwordProvider = { verify: vi.fn<PasswordProvider['verify']>() };
  const replacePassword = {
    execute: vi.fn<ReplacePasswordUseCase['execute']>(),
  };
  const secrets = {
    passwordEncrypted: faker.string.alphanumeric(60),
    emailEncrypted: faker.string.alphanumeric(40),
    addressEncrypted: null,
    encryptionKeyVersion: 2,
  };
  let useCase: ChangePasswordUseCase;

  const user: AuthenticatedUser = {
    userId: faker.database.mongodbObjectId(),
    sessionId: faker.database.mongodbObjectId(),
    familyId: faker.string.uuid(),
    role: UserRole.USER,
  };

  /** Responde `verify` conforme a senha: só a atual confere com o hash guardado. */
  function givenCurrentPassword(current: string) {
    passwordProvider.verify.mockImplementation((plaintext) =>
      Promise.resolve(plaintext === current),
    );
  }

  beforeEach(async () => {
    userRepository.findSecretsById.mockResolvedValue(secrets);
    replacePassword.execute.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChangePasswordUseCase,
        { provide: UserRepository, useValue: userRepository },
        { provide: PasswordProvider, useValue: passwordProvider },
        { provide: ReplacePasswordUseCase, useValue: replacePassword },
      ],
    }).compile();

    useCase = moduleRef.get(ChangePasswordUseCase);
  });

  it('troca a senha quando a atual confere e a nova é diferente', async () => {
    const currentPassword = buildPassword();
    const newPassword = buildPassword();
    givenCurrentPassword(currentPassword);

    await useCase.execute({ user, currentPassword, newPassword });

    expect(replacePassword.execute).toHaveBeenCalledWith({
      userId: user.userId,
      newPassword,
      reason: SessionRevocationReason.PASSWORD_CHANGE,
    });
  });

  it('confere a senha atual contra o valor guardado, com a versão da chave', async () => {
    const currentPassword = buildPassword();
    givenCurrentPassword(currentPassword);

    await useCase.execute({
      user,
      currentPassword,
      newPassword: buildPassword(),
    });

    expect(passwordProvider.verify).toHaveBeenCalledWith(currentPassword, {
      ciphertext: secrets.passwordEncrypted,
      keyVersion: secrets.encryptionKeyVersion,
    });
  });

  describe('senha atual incorreta', () => {
    beforeEach(() => {
      givenCurrentPassword(buildPassword());
    });

    it('recusa', async () => {
      await expect(
        useCase.execute({
          user,
          currentPassword: buildPassword(),
          newPassword: buildPassword(),
        }),
      ).rejects.toBeInstanceOf(InvalidCurrentPasswordException);
    });

    it('não troca a senha nem derruba sessões', async () => {
      await useCase
        .execute({
          user,
          currentPassword: buildPassword(),
          newPassword: buildPassword(),
        })
        .catch(() => undefined);

      expect(replacePassword.execute).not.toHaveBeenCalled();
    });
  });

  describe('senha nova igual à atual', () => {
    it('recusa e não troca nada', async () => {
      const password = buildPassword();
      givenCurrentPassword(password);

      await expect(
        useCase.execute({
          user,
          currentPassword: password,
          newPassword: password,
        }),
      ).rejects.toBeInstanceOf(PasswordUnchangedException);

      expect(replacePassword.execute).not.toHaveBeenCalled();
    });
  });

  it('recusa quando a conta da sessão não existe mais', async () => {
    userRepository.findSecretsById.mockResolvedValue(null);

    await expect(
      useCase.execute({
        user,
        currentPassword: buildPassword(),
        newPassword: buildPassword(),
      }),
    ).rejects.toBeInstanceOf(NotAuthenticatedException);

    expect(passwordProvider.verify).not.toHaveBeenCalled();
  });

  it('propaga a falha ao gravar a nova senha', async () => {
    const currentPassword = buildPassword();
    givenCurrentPassword(currentPassword);
    replacePassword.execute.mockRejectedValue(new Error('banco fora'));

    await expect(
      useCase.execute({
        user,
        currentPassword,
        newPassword: buildPassword(),
      }),
    ).rejects.toThrow('banco fora');
  });
});
