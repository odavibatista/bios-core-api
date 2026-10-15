import { Test } from '@nestjs/testing';
import { UserTokenPurpose } from '@prisma/client';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { buildEmailToken } from '@test/factories/mailing/email-template.factory.js';
import { faker } from '@test/support/faker.js';
import { EmailAlreadyInUseException } from '../../domain/dtos/errors/email-already-in-use.exception.js';
import { InvalidUserTokenException } from '../../domain/dtos/errors/invalid-user-token.exception.js';
import { ConfirmEmailChangeUseCase } from './confirm-email-change.usecase.js';
import { ConsumeUserTokenUseCase } from './consume-user-token.usecase.js';
import { UpdateAccountUseCase } from './update-account.usecase.js';

describe('ConfirmEmailChangeUseCase', () => {
  const consumeUserToken = {
    execute: vi.fn<ConsumeUserTokenUseCase['execute']>(),
  };
  const encryptionProvider = {
    decrypt: vi.fn<EncryptionProvider['decrypt']>(),
  };
  const updateAccount = {
    execute: vi.fn<UpdateAccountUseCase['execute']>(),
  };
  const userId = faker.database.mongodbObjectId();
  let useCase: ConfirmEmailChangeUseCase;

  beforeEach(async () => {
    consumeUserToken.execute.mockResolvedValue({
      userId,
      pendingEmailEncrypted: '2:abc-DEF_123',
    });
    encryptionProvider.decrypt.mockReturnValue('novo@exemplo.com');
    updateAccount.execute.mockResolvedValue('UPDATED');

    const moduleRef = await Test.createTestingModule({
      providers: [
        ConfirmEmailChangeUseCase,
        { provide: ConsumeUserTokenUseCase, useValue: consumeUserToken },
        { provide: EncryptionProvider, useValue: encryptionProvider },
        { provide: UpdateAccountUseCase, useValue: updateAccount },
      ],
    }).compile();

    useCase = moduleRef.get(ConfirmEmailChangeUseCase);
  });

  it('gasta o token como troca de e-mail', async () => {
    const token = buildEmailToken();

    await useCase.execute({ token });

    expect(consumeUserToken.execute).toHaveBeenCalledWith({
      token,
      purpose: UserTokenPurpose.EMAIL_CHANGE,
    });
  });

  it('decifra o e-mail pendente com a versão da chave que o cifrou', async () => {
    await useCase.execute({ token: buildEmailToken() });

    expect(encryptionProvider.decrypt).toHaveBeenCalledWith({
      ciphertext: 'abc-DEF_123',
      keyVersion: 2,
    });
  });

  it('efetiva a troca na conta dona do token', async () => {
    await useCase.execute({ token: buildEmailToken() });

    expect(updateAccount.execute).toHaveBeenCalledWith({
      userId,
      changes: { email: 'novo@exemplo.com' },
    });
  });

  it('recusa quando o token é inválido, sem alterar nada', async () => {
    consumeUserToken.execute.mockRejectedValue(new InvalidUserTokenException());

    await expect(
      useCase.execute({ token: buildEmailToken() }),
    ).rejects.toBeInstanceOf(InvalidUserTokenException);

    expect(updateAccount.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['sem e-mail pendente', null],
    ['com e-mail pendente ilegível', 'pessoa@exemplo.com'],
  ])('recusa token de troca %s', async (_case, pendingEmailEncrypted) => {
    consumeUserToken.execute.mockResolvedValue({
      userId,
      pendingEmailEncrypted,
    });

    await expect(
      useCase.execute({ token: buildEmailToken() }),
    ).rejects.toBeInstanceOf(InvalidUserTokenException);

    expect(updateAccount.execute).not.toHaveBeenCalled();
  });

  it('avisa quando o e-mail passou a ser de outra conta enquanto o link esperava', async () => {
    updateAccount.execute.mockResolvedValue('EMAIL_TAKEN');

    await expect(
      useCase.execute({ token: buildEmailToken() }),
    ).rejects.toBeInstanceOf(EmailAlreadyInUseException);
  });

  it('trata a conta inexistente como token inválido', async () => {
    updateAccount.execute.mockResolvedValue('NOT_FOUND');

    await expect(
      useCase.execute({ token: buildEmailToken() }),
    ).rejects.toBeInstanceOf(InvalidUserTokenException);
  });

  it('propaga a falha ao gravar', async () => {
    updateAccount.execute.mockRejectedValue(new Error('banco fora'));

    await expect(useCase.execute({ token: buildEmailToken() })).rejects.toThrow(
      'banco fora',
    );
  });
});
