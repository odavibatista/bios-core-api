import { Test } from '@nestjs/testing';
import { EmailTemplate, UserTokenPurpose } from '@prisma/client';
import { SendTransactionalEmailUseCase } from '@modules/mailing/infra/usecases/send-transactional-email.usecase.js';
import { buildEmailToken } from '@test/factories/mailing/email-template.factory.js';
import { faker } from '@test/support/faker.js';
import { IssueUserTokenUseCase } from './issue-user-token.usecase.js';
import { SendEmailConfirmationUseCase } from './send-email-confirmation.usecase.js';

describe('SendEmailConfirmationUseCase', () => {
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
  let useCase: SendEmailConfirmationUseCase;

  beforeEach(async () => {
    issueUserToken.execute.mockResolvedValue(issued);
    sendTransactionalEmail.execute.mockResolvedValue(
      faker.database.mongodbObjectId(),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        SendEmailConfirmationUseCase,
        { provide: IssueUserTokenUseCase, useValue: issueUserToken },
        {
          provide: SendTransactionalEmailUseCase,
          useValue: sendTransactionalEmail,
        },
      ],
    }).compile();

    useCase = moduleRef.get(SendEmailConfirmationUseCase);
  });

  it('emite um token de confirmação para a conta', async () => {
    const userId = faker.database.mongodbObjectId();

    await useCase.execute({
      userId,
      name: faker.person.fullName(),
      email: faker.internet.email(),
    });

    expect(issueUserToken.execute).toHaveBeenCalledWith({
      userId,
      purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
    });
  });

  it('envia o template de confirmação com o primeiro nome, o token e a validade', async () => {
    const userId = faker.database.mongodbObjectId();
    const email = faker.internet.email();
    const firstName = faker.string.alpha({ length: 6 });

    await useCase.execute({
      userId,
      name: `${firstName} ${faker.string.alpha({ length: 8 })}`,
      email,
    });

    expect(sendTransactionalEmail.execute).toHaveBeenCalledWith({
      template: EmailTemplate.EMAIL_CONFIRMATION,
      to: email,
      context: {
        name: firstName,
        token: issued.token,
        validity: issued.validity,
      },
      userId,
    });
  });

  it('não envia e-mail se a emissão do token falhar', async () => {
    issueUserToken.execute.mockRejectedValue(new Error('banco fora'));

    await expect(
      useCase.execute({
        userId: faker.database.mongodbObjectId(),
        name: faker.person.fullName(),
        email: faker.internet.email(),
      }),
    ).rejects.toThrow('banco fora');
    expect(sendTransactionalEmail.execute).not.toHaveBeenCalled();
  });
});
