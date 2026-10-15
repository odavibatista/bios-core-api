import { Test } from '@nestjs/testing';
import { EmailTemplate, UserRole, UserTokenPurpose } from '@prisma/client';
import { BlockedEmailDomainException } from '@modules/security/domain/dtos/errors/blocked-email-domain.exception.js';
import { EmailDomainPolicyProvider } from '@modules/security/domain/providers/email-domain-policy.provider.js';
import { SendTransactionalEmailUseCase } from '@modules/mailing/infra/usecases/send-transactional-email.usecase.js';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { PasswordProvider } from '@shared/domain/providers/password.provider.js';
import { buildEmailToken } from '@test/factories/mailing/email-template.factory.js';
import { buildPassword } from '@test/factories/shared/password.factory.js';
import { faker } from '@test/support/faker.js';
import { AccountNotFoundException } from '../../domain/dtos/errors/account-not-found.exception.js';
import { EmailUnchangedException } from '../../domain/dtos/errors/email-unchanged.exception.js';
import { InvalidCurrentPasswordException } from '../../domain/dtos/errors/invalid-current-password.exception.js';
import { UserRepository } from '../../domain/dtos/repositories/user.repository.js';
import { IssueUserTokenUseCase } from './issue-user-token.usecase.js';
import { RequestEmailChangeUseCase } from './request-email-change.usecase.js';

describe('RequestEmailChangeUseCase', () => {
  const userRepository = {
    findSecretsById: vi.fn<UserRepository['findSecretsById']>(),
    findByEmailHash: vi.fn<UserRepository['findByEmailHash']>(),
    findProfileById: vi.fn<UserRepository['findProfileById']>(),
    update: vi.fn<UserRepository['update']>(),
  };
  const passwordProvider = { verify: vi.fn<PasswordProvider['verify']>() };
  const encryptionProvider = {
    encrypt: vi.fn<EncryptionProvider['encrypt']>(),
    blindIndex: vi.fn<EncryptionProvider['blindIndex']>(),
  };
  const emailDomainPolicy = {
    execute: vi.fn<EmailDomainPolicyProvider['execute']>(),
  };
  const issueUserToken = {
    execute: vi.fn<IssueUserTokenUseCase['execute']>(),
  };
  const sendTransactionalEmail = {
    execute: vi.fn<SendTransactionalEmailUseCase['execute']>(),
  };
  const issued = {
    token: buildEmailToken(),
    expiresAt: faker.date.soon(),
    validity: '24 horas',
  };
  const user: AuthenticatedUser = {
    userId: faker.database.mongodbObjectId(),
    sessionId: faker.database.mongodbObjectId(),
    familyId: faker.string.uuid(),
    role: UserRole.USER,
  };
  const secrets = {
    passwordEncrypted: faker.string.alphanumeric(60),
    emailEncrypted: faker.string.alphanumeric(40),
    addressEncrypted: null,
    encryptionKeyVersion: 2,
  };
  const ownerName = `${faker.string.alpha({ length: 6 })} ${faker.string.alpha({ length: 8 })}`;
  let useCase: RequestEmailChangeUseCase;

  function buildRequest(newEmail = faker.internet.email()) {
    return {
      user,
      request: { new_email: newEmail, current_password: buildPassword() },
    };
  }

  beforeEach(async () => {
    userRepository.findSecretsById.mockResolvedValue(secrets);
    userRepository.findByEmailHash.mockResolvedValue(null);
    userRepository.findProfileById.mockResolvedValue({
      id: user.userId,
      name: ownerName,
      isActive: true,
      role: UserRole.USER,
      emailEncrypted: secrets.emailEncrypted,
      addressEncrypted: null,
      encryptionKeyVersion: 2,
    });
    passwordProvider.verify.mockResolvedValue(true);
    encryptionProvider.encrypt.mockImplementation((plaintext) => ({
      ciphertext: `enc(${plaintext})`,
      keyVersion: 2,
    }));
    encryptionProvider.blindIndex.mockImplementation((value) => `idx:${value}`);
    emailDomainPolicy.execute.mockResolvedValue(undefined);
    issueUserToken.execute.mockResolvedValue(issued);
    sendTransactionalEmail.execute.mockResolvedValue(
      faker.database.mongodbObjectId(),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        RequestEmailChangeUseCase,
        { provide: UserRepository, useValue: userRepository },
        { provide: PasswordProvider, useValue: passwordProvider },
        { provide: EncryptionProvider, useValue: encryptionProvider },
        { provide: EmailDomainPolicyProvider, useValue: emailDomainPolicy },
        { provide: IssueUserTokenUseCase, useValue: issueUserToken },
        {
          provide: SendTransactionalEmailUseCase,
          useValue: sendTransactionalEmail,
        },
      ],
    }).compile();

    useCase = moduleRef.get(RequestEmailChangeUseCase);
  });

  describe('pedido válido', () => {
    it('confere a senha atual contra o valor guardado, com a versão da chave', async () => {
      const command = buildRequest();

      await useCase.execute(command);

      expect(passwordProvider.verify).toHaveBeenCalledWith(
        command.request.current_password,
        { ciphertext: secrets.passwordEncrypted, keyVersion: 2 },
      );
    });

    it('emite o token de troca de e-mail com o novo e-mail cifrado e a versão da chave', async () => {
      await useCase.execute(buildRequest(' Novo@Exemplo.COM '));

      expect(issueUserToken.execute).toHaveBeenCalledWith({
        userId: user.userId,
        purpose: UserTokenPurpose.EMAIL_CHANGE,
        pendingEmailEncrypted: '2:enc(novo@exemplo.com)',
      });
    });

    it('envia o link ao NOVO endereço, com o primeiro nome, o token e a validade', async () => {
      await useCase.execute(buildRequest('novo@exemplo.com'));

      expect(sendTransactionalEmail.execute).toHaveBeenCalledWith({
        template: EmailTemplate.EMAIL_CHANGE_CONFIRMATION,
        to: 'novo@exemplo.com',
        context: {
          name: ownerName.split(' ')[0],
          token: issued.token,
          validity: issued.validity,
        },
        userId: user.userId,
      });
    });

    it('não grava o novo e-mail na conta: a troca só vale depois da confirmação', async () => {
      await useCase.execute(buildRequest());

      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it('consulta a blacklist com o e-mail normalizado', async () => {
      await useCase.execute(buildRequest(' Novo@Exemplo.COM '));

      expect(emailDomainPolicy.execute).toHaveBeenCalledWith(
        'novo@exemplo.com',
      );
    });
  });

  describe('senha atual incorreta', () => {
    beforeEach(() => {
      passwordProvider.verify.mockResolvedValue(false);
    });

    it('recusa', async () => {
      await expect(useCase.execute(buildRequest())).rejects.toBeInstanceOf(
        InvalidCurrentPasswordException,
      );
    });

    it('não consulta a blacklist, nem emite token, nem envia e-mail', async () => {
      await useCase.execute(buildRequest()).catch(() => undefined);

      expect(emailDomainPolicy.execute).not.toHaveBeenCalled();
      expect(issueUserToken.execute).not.toHaveBeenCalled();
      expect(sendTransactionalEmail.execute).not.toHaveBeenCalled();
    });
  });

  describe('domínio na blacklist', () => {
    it('recusa e não envia nada', async () => {
      emailDomainPolicy.execute.mockRejectedValue(
        new BlockedEmailDomainException(),
      );

      await expect(useCase.execute(buildRequest())).rejects.toBeInstanceOf(
        BlockedEmailDomainException,
      );

      expect(issueUserToken.execute).not.toHaveBeenCalled();
      expect(sendTransactionalEmail.execute).not.toHaveBeenCalled();
    });
  });

  describe('o novo e-mail já existe', () => {
    it('é o da própria conta: recusa, pois só o titular o conhece', async () => {
      userRepository.findByEmailHash.mockResolvedValue({
        id: user.userId,
        name: ownerName,
        isActive: true,
      });

      await expect(useCase.execute(buildRequest())).rejects.toBeInstanceOf(
        EmailUnchangedException,
      );

      expect(sendTransactionalEmail.execute).not.toHaveBeenCalled();
    });

    it('é de outra conta: termina sem erro e sem enviar nada, para não revelar que existe', async () => {
      userRepository.findByEmailHash.mockResolvedValue({
        id: faker.database.mongodbObjectId(),
        name: faker.person.fullName(),
        isActive: true,
      });

      await expect(useCase.execute(buildRequest())).resolves.toBeUndefined();

      expect(issueUserToken.execute).not.toHaveBeenCalled();
      expect(sendTransactionalEmail.execute).not.toHaveBeenCalled();
    });

    it('é de outra conta ainda não confirmada: o mesmo silêncio', async () => {
      userRepository.findByEmailHash.mockResolvedValue({
        id: faker.database.mongodbObjectId(),
        name: faker.person.fullName(),
        isActive: false,
      });

      await expect(useCase.execute(buildRequest())).resolves.toBeUndefined();

      expect(sendTransactionalEmail.execute).not.toHaveBeenCalled();
    });
  });

  describe('conta inexistente', () => {
    it('recusa quando a conta da sessão não existe mais', async () => {
      userRepository.findSecretsById.mockResolvedValue(null);

      await expect(useCase.execute(buildRequest())).rejects.toBeInstanceOf(
        AccountNotFoundException,
      );

      expect(passwordProvider.verify).not.toHaveBeenCalled();
    });

    it('recusa quando a conta some antes de o nome ser lido', async () => {
      userRepository.findProfileById.mockResolvedValue(null);

      await expect(useCase.execute(buildRequest())).rejects.toBeInstanceOf(
        AccountNotFoundException,
      );

      expect(sendTransactionalEmail.execute).not.toHaveBeenCalled();
    });
  });

  it('não envia e-mail se a emissão do token falhar', async () => {
    issueUserToken.execute.mockRejectedValue(new Error('banco fora'));

    await expect(useCase.execute(buildRequest())).rejects.toThrow('banco fora');

    expect(sendTransactionalEmail.execute).not.toHaveBeenCalled();
  });
});
