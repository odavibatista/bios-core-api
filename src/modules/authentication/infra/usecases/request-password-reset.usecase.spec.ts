import { Test } from '@nestjs/testing';
import { EmailTemplate, UserTokenPurpose } from '@prisma/client';
import {
  type AccountIdentity,
  UserRepository,
} from '@modules/accounts/domain/dtos/repositories/user.repository.js';
import { IssueUserTokenUseCase } from '@modules/accounts/infra/usecases/issue-user-token.usecase.js';
import { SendTransactionalEmailUseCase } from '@modules/mailing/infra/usecases/send-transactional-email.usecase.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { buildEmailToken } from '@test/factories/mailing/email-template.factory.js';
import { faker } from '@test/support/faker.js';
import { RequestPasswordResetUseCase } from './request-password-reset.usecase.js';

describe('RequestPasswordResetUseCase', () => {
  const userRepository = {
    findByEmailHash: vi.fn<UserRepository['findByEmailHash']>(),
  };
  const encryptionProvider = {
    blindIndex: vi.fn<EncryptionProvider['blindIndex']>(),
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
    validity: '2 horas',
  };
  let useCase: RequestPasswordResetUseCase;

  function buildAccount(overrides: Partial<AccountIdentity> = {}) {
    return {
      id: faker.database.mongodbObjectId(),
      name: `${faker.string.alpha({ length: 6 })} ${faker.string.alpha({ length: 8 })}`,
      isActive: true,
      ...overrides,
    };
  }

  beforeEach(async () => {
    encryptionProvider.blindIndex.mockImplementation((value) => `idx:${value}`);
    userRepository.findByEmailHash.mockResolvedValue(null);
    issueUserToken.execute.mockResolvedValue(issued);
    sendTransactionalEmail.execute.mockResolvedValue(
      faker.database.mongodbObjectId(),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        RequestPasswordResetUseCase,
        { provide: UserRepository, useValue: userRepository },
        { provide: EncryptionProvider, useValue: encryptionProvider },
        { provide: IssueUserTokenUseCase, useValue: issueUserToken },
        {
          provide: SendTransactionalEmailUseCase,
          useValue: sendTransactionalEmail,
        },
      ],
    }).compile();

    useCase = moduleRef.get(RequestPasswordResetUseCase);
  });

  describe('conta ativa', () => {
    const account = buildAccount();

    beforeEach(() => {
      userRepository.findByEmailHash.mockResolvedValue(account);
    });

    it('localiza a conta pelo índice cego do e-mail normalizado', async () => {
      const email = faker.internet.email().toLowerCase();

      await useCase.execute({ email: ` ${email.toUpperCase()} ` });

      expect(userRepository.findByEmailHash).toHaveBeenCalledWith(
        `idx:${email}`,
      );
    });

    it('emite um token de recuperação de senha para a conta', async () => {
      await useCase.execute({ email: faker.internet.email() });

      expect(issueUserToken.execute).toHaveBeenCalledWith({
        userId: account.id,
        purpose: UserTokenPurpose.PASSWORD_RESET,
      });
    });

    it('envia o template de recuperação com o primeiro nome, o token e a validade', async () => {
      const email = faker.internet.email().toLowerCase();

      await useCase.execute({ email });

      expect(sendTransactionalEmail.execute).toHaveBeenCalledWith({
        template: EmailTemplate.PASSWORD_RESET,
        to: email,
        context: {
          name: account.name.split(' ')[0],
          token: issued.token,
          validity: issued.validity,
        },
        userId: account.id,
      });
    });

    it('não envia e-mail se a emissão do token falhar', async () => {
      issueUserToken.execute.mockRejectedValue(new Error('banco fora'));

      await expect(
        useCase.execute({ email: faker.internet.email() }),
      ).rejects.toThrow('banco fora');

      expect(sendTransactionalEmail.execute).not.toHaveBeenCalled();
    });
  });

  describe('sem conta ativa para o e-mail', () => {
    it('e-mail desconhecido: termina sem erro e sem enviar nada', async () => {
      userRepository.findByEmailHash.mockResolvedValue(null);

      await expect(
        useCase.execute({ email: faker.internet.email() }),
      ).resolves.toBeUndefined();

      expect(issueUserToken.execute).not.toHaveBeenCalled();
      expect(sendTransactionalEmail.execute).not.toHaveBeenCalled();
    });

    it('conta não confirmada: não recebe link de recuperação', async () => {
      userRepository.findByEmailHash.mockResolvedValue(
        buildAccount({ isActive: false }),
      );

      await expect(
        useCase.execute({ email: faker.internet.email() }),
      ).resolves.toBeUndefined();

      // A saída dela é confirmar o e-mail (UC01); a recuperação a contornaria.
      expect(issueUserToken.execute).not.toHaveBeenCalled();
      expect(sendTransactionalEmail.execute).not.toHaveBeenCalled();
    });
  });
});
