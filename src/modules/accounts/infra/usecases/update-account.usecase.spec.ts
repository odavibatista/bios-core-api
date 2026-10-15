import { Test } from '@nestjs/testing';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { faker } from '@test/support/faker.js';
import { serializeAddress } from '../../domain/address.js';
import {
  type AccountSecrets,
  UserRepository,
} from '../../domain/dtos/repositories/user.repository.js';
import type { Address } from '../../domain/dtos/requests/address.dto.js';
import { UpdateAccountUseCase } from './update-account.usecase.js';

describe('UpdateAccountUseCase', () => {
  const userRepository = {
    findSecretsById: vi.fn<UserRepository['findSecretsById']>(),
    update: vi.fn<UserRepository['update']>(),
  };
  const encryptionProvider = {
    activeKeyVersion: 1,
    encrypt: vi.fn<EncryptionProvider['encrypt']>(),
    decrypt: vi.fn<EncryptionProvider['decrypt']>(),
    blindIndex: vi.fn<EncryptionProvider['blindIndex']>(),
  };
  const userId = faker.database.mongodbObjectId();
  let useCase: UpdateAccountUseCase;

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

  function buildAddress(): Address {
    return {
      postal_code: '01310-100',
      street: faker.location.street(),
      number: '1578',
      neighborhood: faker.location.county(),
      city: faker.location.city(),
      state: 'SP',
    };
  }

  /** O hash de senha, como o `PasswordProvider` o devolve. */
  function buildHash(keyVersion = 1) {
    return { ciphertext: faker.string.alphanumeric(60), keyVersion };
  }

  /** Simula a cifragem na versão ativa e a decifragem de qualquer versão. */
  function useKeyVersions(active: number) {
    encryptionProvider.activeKeyVersion = active;
    encryptionProvider.encrypt.mockImplementation((plaintext) => ({
      ciphertext: `enc(${plaintext})`,
      keyVersion: active,
    }));
    encryptionProvider.decrypt.mockImplementation(
      ({ ciphertext, keyVersion }) => `plain(${ciphertext}@v${keyVersion})`,
    );
  }

  beforeEach(async () => {
    vi.useFakeTimers({ now: faker.date.recent() });
    useKeyVersions(1);
    encryptionProvider.blindIndex.mockImplementation((value) => `idx:${value}`);
    userRepository.findSecretsById.mockResolvedValue(buildSecrets());
    userRepository.update.mockResolvedValue('UPDATED');

    const moduleRef = await Test.createTestingModule({
      providers: [
        UpdateAccountUseCase,
        { provide: UserRepository, useValue: userRepository },
        { provide: EncryptionProvider, useValue: encryptionProvider },
      ],
    }).compile();

    useCase = moduleRef.get(UpdateAccountUseCase);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('chave do documento já é a ativa', () => {
    it('grava só o nome, sem tocar nos campos cifrados', async () => {
      await useCase.execute({ userId, changes: { name: 'Novo Nome' } });

      expect(userRepository.update).toHaveBeenCalledWith(userId, {
        name: 'Novo Nome',
      });
      expect(encryptionProvider.decrypt).not.toHaveBeenCalled();
    });

    it('grava a senha nova com a data da troca', async () => {
      const hash = buildHash();

      await useCase.execute({ userId, changes: { password: hash } });

      expect(userRepository.update).toHaveBeenCalledWith(userId, {
        passwordEncrypted: hash.ciphertext,
        passwordChangedAt: new Date(),
      });
    });

    it('grava o e-mail novo cifrado, com o índice cego e a data de confirmação', async () => {
      await useCase.execute({
        userId,
        changes: { email: 'novo@exemplo.com' },
      });

      expect(userRepository.update).toHaveBeenCalledWith(userId, {
        emailEncrypted: 'enc(novo@exemplo.com)',
        emailHash: 'idx:novo@exemplo.com',
        emailConfirmedAt: new Date(),
      });
    });

    it('grava o endereço serializado e cifrado', async () => {
      const address = buildAddress();

      await useCase.execute({ userId, changes: { address } });

      expect(userRepository.update).toHaveBeenCalledWith(userId, {
        addressEncrypted: `enc(${serializeAddress(address)})`,
      });
    });

    it('guarda o CEP só com dígitos', async () => {
      await useCase.execute({
        userId,
        changes: { address: buildAddress() },
      });

      const [, update] = userRepository.update.mock.calls[0];
      expect(update.addressEncrypted).toContain('"postal_code":"01310100"');
    });

    it('remove o endereço quando recebe null', async () => {
      await useCase.execute({ userId, changes: { address: null } });

      expect(userRepository.update).toHaveBeenCalledWith(userId, {
        addressEncrypted: null,
      });
    });

    it('não recifra nada nem muda a versão da chave', async () => {
      await useCase.execute({
        userId,
        changes: { name: 'Nome', address: buildAddress() },
      });

      const [, update] = userRepository.update.mock.calls[0];
      expect(update).not.toHaveProperty('encryptionKeyVersion');
      expect(encryptionProvider.decrypt).not.toHaveBeenCalled();
    });

    it('aplica várias alterações numa só gravação', async () => {
      await useCase.execute({
        userId,
        changes: { name: 'Nome', email: 'a@b.com', address: null },
      });

      expect(userRepository.update).toHaveBeenCalledOnce();
    });
  });

  describe('chave ativa mais nova que a do documento (rotação)', () => {
    beforeEach(() => {
      useKeyVersions(2);
    });

    it('recifra todos os campos cifrados e registra a versão ativa', async () => {
      const secrets = buildSecrets({
        addressEncrypted: faker.string.alphanumeric(50),
      });
      userRepository.findSecretsById.mockResolvedValue(secrets);

      await useCase.execute({ userId, changes: { name: 'Novo Nome' } });

      expect(userRepository.update).toHaveBeenCalledWith(userId, {
        name: 'Novo Nome',
        passwordEncrypted: `enc(plain(${secrets.passwordEncrypted}@v1))`,
        emailEncrypted: `enc(plain(${secrets.emailEncrypted}@v1))`,
        addressEncrypted: `enc(plain(${secrets.addressEncrypted}@v1))`,
        encryptionKeyVersion: 2,
      });
    });

    it('usa o valor novo no campo alterado e recifra os demais', async () => {
      const secrets = buildSecrets();
      userRepository.findSecretsById.mockResolvedValue(secrets);

      await useCase.execute({
        userId,
        changes: { email: 'novo@exemplo.com' },
      });

      const [, update] = userRepository.update.mock.calls[0];
      expect(update).toMatchObject({
        emailEncrypted: 'enc(novo@exemplo.com)',
        passwordEncrypted: `enc(plain(${secrets.passwordEncrypted}@v1))`,
        encryptionKeyVersion: 2,
      });
    });

    it('troca a senha sem decifrar a antiga e recifra e-mail e endereço', async () => {
      const secrets = buildSecrets({
        addressEncrypted: faker.string.alphanumeric(50),
      });
      userRepository.findSecretsById.mockResolvedValue(secrets);
      const hash = buildHash(2);

      await useCase.execute({ userId, changes: { password: hash } });

      const [, update] = userRepository.update.mock.calls[0];
      expect(update.passwordEncrypted).toBe(hash.ciphertext);
      expect(update.emailEncrypted).toBe(
        `enc(plain(${secrets.emailEncrypted}@v1))`,
      );
      expect(update.addressEncrypted).toBe(
        `enc(plain(${secrets.addressEncrypted}@v1))`,
      );
      expect(update.encryptionKeyVersion).toBe(2);
    });

    it('não inventa endereço quando a conta não tem', async () => {
      await useCase.execute({ userId, changes: { name: 'Nome' } });

      const [, update] = userRepository.update.mock.calls[0];
      expect(update).not.toHaveProperty('addressEncrypted');
    });

    it('remove o endereço sem recifrá-lo', async () => {
      userRepository.findSecretsById.mockResolvedValue(
        buildSecrets({ addressEncrypted: faker.string.alphanumeric(50) }),
      );

      await useCase.execute({ userId, changes: { address: null } });

      const [, update] = userRepository.update.mock.calls[0];
      expect(update.addressEncrypted).toBeNull();
    });

    it('não grava nada se um campo antigo não puder ser decifrado', async () => {
      encryptionProvider.decrypt.mockImplementation(() => {
        throw new Error('chave ausente');
      });

      await expect(
        useCase.execute({ userId, changes: { name: 'Nome' } }),
      ).rejects.toThrow('chave ausente');

      expect(userRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('defeito de quem chama', () => {
    it('recusa um hash de senha cifrado com versão que não é a ativa', async () => {
      await expect(
        useCase.execute({ userId, changes: { password: buildHash(7) } }),
      ).rejects.toThrow(/versão 7/);

      expect(userRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('desfechos', () => {
    it('devolve NOT_FOUND, sem gravar, quando a conta não existe', async () => {
      userRepository.findSecretsById.mockResolvedValue(null);

      await expect(
        useCase.execute({ userId, changes: { name: 'Nome' } }),
      ).resolves.toBe('NOT_FOUND');

      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it.each(['UPDATED', 'NOT_FOUND', 'EMAIL_TAKEN'] as const)(
      'repassa o desfecho %s do repositório',
      async (outcome) => {
        userRepository.update.mockResolvedValue(outcome);

        await expect(
          useCase.execute({ userId, changes: { email: 'a@b.com' } }),
        ).resolves.toBe(outcome);
      },
    );
  });
});
