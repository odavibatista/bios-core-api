import { Test } from '@nestjs/testing';
import { BlockedEmailDomainException } from '@modules/security/domain/dtos/errors/blocked-email-domain.exception.js';
import { EmailDomainPolicyProvider } from '@modules/security/domain/providers/email-domain-policy.provider.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { PasswordProvider } from '@shared/domain/providers/password.provider.js';
import { buildPassword } from '@test/factories/shared/password.factory.js';
import { faker } from '@test/support/faker.js';
import { UserRepository } from '../../domain/dtos/repositories/user.repository.js';
import { RegisterUserUseCase } from './register-user.usecase.js';
import { SendEmailConfirmationUseCase } from './send-email-confirmation.usecase.js';

describe('RegisterUserUseCase', () => {
  const emailDomainPolicy = {
    execute: vi.fn<EmailDomainPolicyProvider['execute']>(),
  };
  const passwordProvider = {
    hash: vi.fn<PasswordProvider['hash']>(),
  };
  const encryptionProvider = {
    encrypt: vi.fn<EncryptionProvider['encrypt']>(),
    blindIndex: vi.fn<EncryptionProvider['blindIndex']>(),
  };
  const userRepository = {
    createInactive: vi.fn<UserRepository['createInactive']>(),
  };
  const sendEmailConfirmation = {
    execute: vi.fn<SendEmailConfirmationUseCase['execute']>(),
  };
  let useCase: RegisterUserUseCase;

  function buildRequest() {
    return {
      name: faker.person.fullName(),
      email: faker.internet.email(),
      password: buildPassword(),
    };
  }

  beforeEach(async () => {
    emailDomainPolicy.execute.mockResolvedValue(undefined);
    passwordProvider.hash.mockResolvedValue({
      ciphertext: faker.string.alphanumeric(60),
      keyVersion: 3,
    });
    encryptionProvider.encrypt.mockImplementation((plaintext) => ({
      ciphertext: `enc:${plaintext}`,
      keyVersion: 3,
    }));
    encryptionProvider.blindIndex.mockImplementation((value) => `idx:${value}`);
    userRepository.createInactive.mockResolvedValue(
      faker.database.mongodbObjectId(),
    );
    sendEmailConfirmation.execute.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RegisterUserUseCase,
        { provide: EmailDomainPolicyProvider, useValue: emailDomainPolicy },
        { provide: PasswordProvider, useValue: passwordProvider },
        { provide: EncryptionProvider, useValue: encryptionProvider },
        { provide: UserRepository, useValue: userRepository },
        {
          provide: SendEmailConfirmationUseCase,
          useValue: sendEmailConfirmation,
        },
      ],
    }).compile();

    useCase = moduleRef.get(RegisterUserUseCase);
  });

  it('cria a conta inativa com e-mail cifrado, índice cego e senha protegida', async () => {
    const request = buildRequest();
    const normalized = request.email.trim().toLowerCase();
    const passwordEncrypted = faker.string.alphanumeric(60);
    passwordProvider.hash.mockResolvedValue({
      ciphertext: passwordEncrypted,
      keyVersion: 3,
    });

    await useCase.execute(request);

    expect(userRepository.createInactive).toHaveBeenCalledWith({
      name: request.name.trim(),
      emailEncrypted: `enc:${normalized}`,
      emailHash: `idx:${normalized}`,
      passwordEncrypted,
      encryptionKeyVersion: 3,
    });
  });

  it('não entrega a senha em claro ao repositório', async () => {
    const request = buildRequest();

    await useCase.execute(request);

    const [saved] = userRepository.createInactive.mock.calls[0];
    expect(JSON.stringify(saved)).not.toContain(request.password);
  });

  it('normaliza o e-mail antes de consultar a blacklist, cifrar e indexar', async () => {
    const email = faker.internet.email().toLowerCase();

    await useCase.execute({
      ...buildRequest(),
      email: `  ${email.toUpperCase()} `,
    });

    expect(emailDomainPolicy.execute).toHaveBeenCalledWith(email);
    expect(encryptionProvider.encrypt).toHaveBeenCalledWith(email);
    expect(encryptionProvider.blindIndex).toHaveBeenCalledWith(email);
  });

  it('manda o link de confirmação ao e-mail normalizado da conta criada', async () => {
    const request = buildRequest();
    const userId = faker.database.mongodbObjectId();
    userRepository.createInactive.mockResolvedValue(userId);

    await useCase.execute(request);

    expect(sendEmailConfirmation.execute).toHaveBeenCalledWith({
      userId,
      name: request.name.trim(),
      email: request.email.trim().toLowerCase(),
    });
  });

  describe('domínio na blacklist', () => {
    beforeEach(() => {
      emailDomainPolicy.execute.mockRejectedValue(
        new BlockedEmailDomainException(),
      );
    });

    it('recusa o cadastro', async () => {
      await expect(useCase.execute(buildRequest())).rejects.toBeInstanceOf(
        BlockedEmailDomainException,
      );
    });

    it('não faz hash, não cria conta e não envia e-mail', async () => {
      await useCase.execute(buildRequest()).catch(() => undefined);

      expect(passwordProvider.hash).not.toHaveBeenCalled();
      expect(userRepository.createInactive).not.toHaveBeenCalled();
      expect(sendEmailConfirmation.execute).not.toHaveBeenCalled();
    });
  });

  describe('e-mail já cadastrado', () => {
    beforeEach(() => {
      userRepository.createInactive.mockResolvedValue(null);
    });

    it('termina sem erro, para não revelar que a conta existe', async () => {
      await expect(useCase.execute(buildRequest())).resolves.toBeUndefined();
    });

    it('não envia novo e-mail de confirmação', async () => {
      await useCase.execute(buildRequest());

      expect(sendEmailConfirmation.execute).not.toHaveBeenCalled();
    });

    it('faz o hash da senha do mesmo jeito, para igualar o tempo de resposta', async () => {
      await useCase.execute(buildRequest());

      // Sem isto, o caminho do e-mail repetido seria visivelmente mais rápido.
      expect(passwordProvider.hash).toHaveBeenCalledOnce();
    });
  });

  it('propaga a falha ao criar a conta, sem enviar e-mail', async () => {
    userRepository.createInactive.mockRejectedValue(new Error('banco fora'));

    await expect(useCase.execute(buildRequest())).rejects.toThrow('banco fora');
    expect(sendEmailConfirmation.execute).not.toHaveBeenCalled();
  });
});
