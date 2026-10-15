import { Test } from '@nestjs/testing';
import { SessionRevocationReason } from '@prisma/client';
import {
  type AccountSecrets,
  UserRepository,
} from '@modules/accounts/domain/dtos/repositories/user.repository.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { PasswordProvider } from '@shared/domain/providers/password.provider.js';
import { buildPassword } from '@test/factories/shared/password.factory.js';
import { faker } from '@test/support/faker.js';
import { NotAuthenticatedException } from '../../domain/dtos/errors/not-authenticated.exception.js';
import { UserSessionRepository } from '../../domain/dtos/repositories/user-session.repository.js';
import { ReplacePasswordUseCase } from './replace-password.usecase.js';

describe('ReplacePasswordUseCase', () => {
  const userRepository = {
    findSecretsById: vi.fn<UserRepository['findSecretsById']>(),
    updatePassword: vi.fn<UserRepository['updatePassword']>(),
  };
  const userSessionRepository = {
    revokeAllActive: vi.fn<UserSessionRepository['revokeAllActive']>(),
  };
  const passwordProvider = { hash: vi.fn<PasswordProvider['hash']>() };
  const encryptionProvider = {
    encrypt: vi.fn<EncryptionProvider['encrypt']>(),
    decrypt: vi.fn<EncryptionProvider['decrypt']>(),
  };
  const hashed = { ciphertext: faker.string.alphanumeric(60), keyVersion: 1 };
  let useCase: ReplacePasswordUseCase;

  function buildSecrets(
    overrides: Partial<AccountSecrets> = {},
  ): AccountSecrets {
    return {
      passwordEncrypted: faker.string.alphanumeric(60),
      emailEncrypted: faker.string.alphanumeric(40),
      addressEncrypted: null,
      encryptionKeyVersion: 1,
      ...overrides,
    };
  }

  function buildCommand(
    reason: SessionRevocationReason = SessionRevocationReason.PASSWORD_CHANGE,
  ) {
    return {
      userId: faker.database.mongodbObjectId(),
      newPassword: buildPassword(),
      reason,
    };
  }

  beforeEach(async () => {
    vi.useFakeTimers({ now: faker.date.recent() });
    userRepository.findSecretsById.mockResolvedValue(buildSecrets());
    userRepository.updatePassword.mockResolvedValue(true);
    userSessionRepository.revokeAllActive.mockResolvedValue(2);
    passwordProvider.hash.mockResolvedValue(hashed);
    encryptionProvider.decrypt.mockImplementation(
      ({ ciphertext, keyVersion }) => `plain(${ciphertext}@v${keyVersion})`,
    );
    encryptionProvider.encrypt.mockImplementation((plaintext) => ({
      ciphertext: `enc(${plaintext})`,
      keyVersion: 2,
    }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReplacePasswordUseCase,
        { provide: UserRepository, useValue: userRepository },
        { provide: UserSessionRepository, useValue: userSessionRepository },
        { provide: PasswordProvider, useValue: passwordProvider },
        { provide: EncryptionProvider, useValue: encryptionProvider },
      ],
    }).compile();

    useCase = moduleRef.get(ReplacePasswordUseCase);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('chave inalterada', () => {
    it('grava só a senha nova, com a versão de chave do hash e a data da troca', async () => {
      const command = buildCommand();

      await useCase.execute(command);

      expect(passwordProvider.hash).toHaveBeenCalledWith(command.newPassword);
      expect(userRepository.updatePassword).toHaveBeenCalledWith(
        command.userId,
        {
          passwordEncrypted: hashed.ciphertext,
          encryptionKeyVersion: 1,
          changedAt: new Date(),
        },
      );
    });

    it('não recifra e-mail nem endereço', async () => {
      userRepository.findSecretsById.mockResolvedValue(
        buildSecrets({ addressEncrypted: faker.string.alphanumeric(60) }),
      );

      await useCase.execute(buildCommand());

      expect(encryptionProvider.decrypt).not.toHaveBeenCalled();
      expect(encryptionProvider.encrypt).not.toHaveBeenCalled();
    });

    it('não entrega a senha em claro ao repositório', async () => {
      const command = buildCommand();

      await useCase.execute(command);

      const [, update] = userRepository.updatePassword.mock.calls[0];
      expect(JSON.stringify(update)).not.toContain(command.newPassword);
    });
  });

  describe('chave ativa mais nova que a do documento (rotação)', () => {
    beforeEach(() => {
      passwordProvider.hash.mockResolvedValue({ ...hashed, keyVersion: 2 });
    });

    it('recifra o e-mail com a chave ativa na mesma gravação', async () => {
      const secrets = buildSecrets({ encryptionKeyVersion: 1 });
      userRepository.findSecretsById.mockResolvedValue(secrets);

      await useCase.execute(buildCommand());

      expect(encryptionProvider.decrypt).toHaveBeenCalledWith({
        ciphertext: secrets.emailEncrypted,
        keyVersion: 1,
      });
      const [, update] = userRepository.updatePassword.mock.calls[0];
      expect(update).toMatchObject({
        encryptionKeyVersion: 2,
        emailEncrypted: `enc(plain(${secrets.emailEncrypted}@v1))`,
      });
    });

    it('recifra também o endereço, quando a conta tem', async () => {
      const secrets = buildSecrets({
        encryptionKeyVersion: 1,
        addressEncrypted: faker.string.alphanumeric(60),
      });
      userRepository.findSecretsById.mockResolvedValue(secrets);

      await useCase.execute(buildCommand());

      const [, update] = userRepository.updatePassword.mock.calls[0];
      expect(update.addressEncrypted).toBe(
        `enc(plain(${secrets.addressEncrypted}@v1))`,
      );
    });

    it('não inventa endereço quando a conta não tem', async () => {
      await useCase.execute(buildCommand());

      const [, update] = userRepository.updatePassword.mock.calls[0];
      expect(update).not.toHaveProperty('addressEncrypted');
    });

    it('não grava nada se o e-mail antigo não puder ser decifrado', async () => {
      encryptionProvider.decrypt.mockImplementation(() => {
        throw new Error('chave ausente');
      });

      await expect(useCase.execute(buildCommand())).rejects.toThrow(
        'chave ausente',
      );

      expect(userRepository.updatePassword).not.toHaveBeenCalled();
      expect(userSessionRepository.revokeAllActive).not.toHaveBeenCalled();
    });
  });

  describe('sessões', () => {
    it.each([
      SessionRevocationReason.PASSWORD_CHANGE,
      SessionRevocationReason.PASSWORD_RESET,
    ])('revoga todas as sessões ativas do usuário como %s', async (reason) => {
      const command = buildCommand(reason);

      await useCase.execute(command);

      expect(userSessionRepository.revokeAllActive).toHaveBeenCalledWith(
        command.userId,
        reason,
        new Date(),
      );
    });

    it('grava a senha antes de revogar as sessões', async () => {
      await useCase.execute(buildCommand());

      // Na ordem inversa, quem soubesse a senha antiga abriria uma sessão nova
      // entre a revogação e a gravação.
      expect(
        userRepository.updatePassword.mock.invocationCallOrder[0],
      ).toBeLessThan(
        userSessionRepository.revokeAllActive.mock.invocationCallOrder[0],
      );
    });

    it('não revoga sessões se a gravação da senha falhar', async () => {
      userRepository.updatePassword.mockRejectedValue(new Error('banco fora'));

      await expect(useCase.execute(buildCommand())).rejects.toThrow(
        'banco fora',
      );

      expect(userSessionRepository.revokeAllActive).not.toHaveBeenCalled();
    });
  });

  describe('conta inexistente', () => {
    it('recusa quando a conta não existe mais', async () => {
      userRepository.findSecretsById.mockResolvedValue(null);

      await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
        NotAuthenticatedException,
      );

      expect(passwordProvider.hash).not.toHaveBeenCalled();
      expect(userSessionRepository.revokeAllActive).not.toHaveBeenCalled();
    });

    it('recusa quando a conta some entre a leitura e a gravação', async () => {
      userRepository.updatePassword.mockResolvedValue(false);

      await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
        NotAuthenticatedException,
      );

      expect(userSessionRepository.revokeAllActive).not.toHaveBeenCalled();
    });
  });
});
