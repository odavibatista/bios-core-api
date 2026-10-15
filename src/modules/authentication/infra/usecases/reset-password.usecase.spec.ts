import { Test } from '@nestjs/testing';
import { SessionRevocationReason, UserTokenPurpose } from '@prisma/client';
import { InvalidUserTokenException } from '@modules/accounts/domain/dtos/errors/invalid-user-token.exception.js';
import { ConsumeUserTokenUseCase } from '@modules/accounts/infra/usecases/consume-user-token.usecase.js';
import { buildEmailToken } from '@test/factories/mailing/email-template.factory.js';
import { buildPassword } from '@test/factories/shared/password.factory.js';
import { faker } from '@test/support/faker.js';
import { ReplacePasswordUseCase } from './replace-password.usecase.js';
import { ResetPasswordUseCase } from './reset-password.usecase.js';

describe('ResetPasswordUseCase', () => {
  const consumeUserToken = {
    execute: vi.fn<ConsumeUserTokenUseCase['execute']>(),
  };
  const replacePassword = {
    execute: vi.fn<ReplacePasswordUseCase['execute']>(),
  };
  let useCase: ResetPasswordUseCase;

  beforeEach(async () => {
    replacePassword.execute.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ResetPasswordUseCase,
        { provide: ConsumeUserTokenUseCase, useValue: consumeUserToken },
        { provide: ReplacePasswordUseCase, useValue: replacePassword },
      ],
    }).compile();

    useCase = moduleRef.get(ResetPasswordUseCase);
  });

  it('gasta o token como recuperação de senha e redefine a senha da conta dele', async () => {
    const token = buildEmailToken();
    const newPassword = buildPassword();
    const userId = faker.database.mongodbObjectId();
    consumeUserToken.execute.mockResolvedValue({
      userId,
      pendingEmailEncrypted: null,
    });

    await useCase.execute({ token, new_password: newPassword });

    expect(consumeUserToken.execute).toHaveBeenCalledWith({
      token,
      purpose: UserTokenPurpose.PASSWORD_RESET,
    });
    expect(replacePassword.execute).toHaveBeenCalledWith({
      userId,
      newPassword,
      reason: SessionRevocationReason.PASSWORD_RESET,
    });
  });

  it('não redefine nada quando o token é inválido', async () => {
    consumeUserToken.execute.mockRejectedValue(new InvalidUserTokenException());

    await expect(
      useCase.execute({
        token: buildEmailToken(),
        new_password: buildPassword(),
      }),
    ).rejects.toBeInstanceOf(InvalidUserTokenException);

    expect(replacePassword.execute).not.toHaveBeenCalled();
  });

  it('propaga a falha ao gravar a senha, com o token já gasto', async () => {
    consumeUserToken.execute.mockResolvedValue({
      userId: faker.database.mongodbObjectId(),
      pendingEmailEncrypted: null,
    });
    replacePassword.execute.mockRejectedValue(new Error('banco fora'));

    await expect(
      useCase.execute({
        token: buildEmailToken(),
        new_password: buildPassword(),
      }),
    ).rejects.toThrow('banco fora');
  });
});
