import { Test } from '@nestjs/testing';
import { UserTokenPurpose } from '@prisma/client';
import { buildEmailToken } from '@test/factories/mailing/email-template.factory.js';
import { faker } from '@test/support/faker.js';
import { InvalidUserTokenException } from '../../domain/dtos/errors/invalid-user-token.exception.js';
import { UserRepository } from '../../domain/dtos/repositories/user.repository.js';
import { ConfirmEmailUseCase } from './confirm-email.usecase.js';
import { ConsumeUserTokenUseCase } from './consume-user-token.usecase.js';

describe('ConfirmEmailUseCase', () => {
  const consumeUserToken = {
    execute: vi.fn<ConsumeUserTokenUseCase['execute']>(),
  };
  const userRepository = { activate: vi.fn<UserRepository['activate']>() };
  let useCase: ConfirmEmailUseCase;

  beforeEach(async () => {
    vi.useFakeTimers({ now: faker.date.recent() });
    userRepository.activate.mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ConfirmEmailUseCase,
        { provide: ConsumeUserTokenUseCase, useValue: consumeUserToken },
        { provide: UserRepository, useValue: userRepository },
      ],
    }).compile();

    useCase = moduleRef.get(ConfirmEmailUseCase);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gasta o token como confirmação de cadastro e ativa a conta dele', async () => {
    const token = buildEmailToken();
    const userId = faker.database.mongodbObjectId();
    consumeUserToken.execute.mockResolvedValue({
      userId,
      pendingEmailEncrypted: null,
    });

    await useCase.execute({ token });

    expect(consumeUserToken.execute).toHaveBeenCalledWith({
      token,
      purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
    });
    expect(userRepository.activate).toHaveBeenCalledWith(userId, new Date());
  });

  it('não ativa conta alguma quando o token é inválido', async () => {
    consumeUserToken.execute.mockRejectedValue(new InvalidUserTokenException());

    await expect(
      useCase.execute({ token: buildEmailToken() }),
    ).rejects.toBeInstanceOf(InvalidUserTokenException);
    expect(userRepository.activate).not.toHaveBeenCalled();
  });

  it('não falha quando a conta já estava ativa', async () => {
    consumeUserToken.execute.mockResolvedValue({
      userId: faker.database.mongodbObjectId(),
      pendingEmailEncrypted: null,
    });
    userRepository.activate.mockResolvedValue(false);

    // O token era legítimo e o resultado desejado — conta ativa — já vale.
    await expect(
      useCase.execute({ token: buildEmailToken() }),
    ).resolves.toBeUndefined();
  });
});
