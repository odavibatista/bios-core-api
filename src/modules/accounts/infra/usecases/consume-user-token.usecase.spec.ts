import { Test } from '@nestjs/testing';
import { UserTokenPurpose } from '@prisma/client';
import { OpaqueTokenProvider } from '@shared/domain/providers/opaque-token.provider.js';
import { userTokenFactory } from '@test/factories/accounts/user-token.factory.js';
import { faker } from '@test/support/faker.js';
import { InvalidUserTokenException } from '../../domain/dtos/errors/invalid-user-token.exception.js';
import { UserTokenRepository } from '../../domain/dtos/repositories/user-token.repository.js';
import { ConsumeUserTokenUseCase } from './consume-user-token.usecase.js';

describe('ConsumeUserTokenUseCase', () => {
  const userTokenRepository = {
    consume: vi.fn<UserTokenRepository['consume']>(),
  };
  const opaqueTokenProvider = { hash: vi.fn((token: string) => `h:${token}`) };
  let useCase: ConsumeUserTokenUseCase;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: faker.date.recent() });
    userTokenRepository.consume.mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ConsumeUserTokenUseCase,
        { provide: UserTokenRepository, useValue: userTokenRepository },
        { provide: OpaqueTokenProvider, useValue: opaqueTokenProvider },
      ],
    }).compile();

    useCase = moduleRef.get(ConsumeUserTokenUseCase);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('devolve o usuário dono do token consumido', async () => {
    const stored = userTokenFactory.build({
      purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
      pending_email_encrypted: null,
    });
    userTokenRepository.consume.mockResolvedValue(stored);

    await expect(
      useCase.execute({
        token: faker.string.alphanumeric(43),
        purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
      }),
    ).resolves.toEqual({ userId: stored.user_id, pendingEmailEncrypted: null });
  });

  it('devolve o novo e-mail cifrado na troca de e-mail', async () => {
    const stored = userTokenFactory.build({
      purpose: UserTokenPurpose.EMAIL_CHANGE,
      pending_email_encrypted: faker.string.alphanumeric(64),
    });
    userTokenRepository.consume.mockResolvedValue(stored);

    const consumed = await useCase.execute({
      token: faker.string.alphanumeric(43),
      purpose: UserTokenPurpose.EMAIL_CHANGE,
    });

    expect(consumed.pendingEmailEncrypted).toBe(stored.pending_email_encrypted);
  });

  it('busca pelo resumo do token, na finalidade e no instante da chamada', async () => {
    const token = faker.string.alphanumeric(43);

    await useCase
      .execute({ token, purpose: UserTokenPurpose.PASSWORD_RESET })
      .catch(() => undefined);

    // O valor puro nunca chega ao repositório.
    expect(userTokenRepository.consume).toHaveBeenCalledWith({
      tokenHash: `h:${token}`,
      purpose: UserTokenPurpose.PASSWORD_RESET,
      now: new Date(),
    });
  });

  it('recusa o token que o repositório não reconhece como válido', async () => {
    userTokenRepository.consume.mockResolvedValue(null);

    await expect(
      useCase.execute({
        token: faker.string.alphanumeric(43),
        purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
      }),
    ).rejects.toBeInstanceOf(InvalidUserTokenException);
  });

  it('usa o mesmo erro, sem detalhe, para qualquer motivo de recusa', async () => {
    const attempt = useCase.execute({
      token: faker.string.alphanumeric(43),
      purpose: UserTokenPurpose.PASSWORD_RESET,
    });

    // Expirado, usado, de outra finalidade e inexistente são indistinguíveis.
    await expect(attempt).rejects.toMatchObject({
      code: 'USER_TOKEN_INVALID',
      details: undefined,
    });
  });
});
