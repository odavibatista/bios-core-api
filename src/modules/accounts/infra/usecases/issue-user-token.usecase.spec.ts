import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { UserTokenPurpose } from '@prisma/client';
import { Duration } from '@shared/domain/value-objects/duration.js';
import { OpaqueTokenProvider } from '@shared/domain/providers/opaque-token.provider.js';
import { faker } from '@test/support/faker.js';
import { UserTokenRepository } from '../../domain/dtos/repositories/user-token.repository.js';
import { IssueUserTokenUseCase } from './issue-user-token.usecase.js';

describe('IssueUserTokenUseCase', () => {
  const lifetimes = {
    AUTH_EMAIL_CONFIRMATION_TOKEN_LIFETIME: Duration.parse('24h'),
    AUTH_PASSWORD_RESET_TOKEN_LIFETIME: Duration.parse('2h'),
  };
  const userTokenRepository = {
    replacePending: vi.fn<UserTokenRepository['replacePending']>(),
  };
  const generated = {
    token: faker.string.alphanumeric(43),
    hash: faker.string.hexadecimal({ length: 64, prefix: '' }),
  };
  const opaqueTokenProvider = { generate: vi.fn(() => generated) };
  let useCase: IssueUserTokenUseCase;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: faker.date.recent() });
    userTokenRepository.replacePending.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        IssueUserTokenUseCase,
        { provide: UserTokenRepository, useValue: userTokenRepository },
        { provide: OpaqueTokenProvider, useValue: opaqueTokenProvider },
        {
          provide: ConfigService,
          useValue: { get: (name: keyof typeof lifetimes) => lifetimes[name] },
        },
      ],
    }).compile();

    useCase = moduleRef.get(IssueUserTokenUseCase);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('devolve o valor puro do token para compor o link', async () => {
    const issued = await useCase.execute({
      userId: faker.database.mongodbObjectId(),
      purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
    });

    expect(issued.token).toBe(generated.token);
  });

  it('grava só o resumo, nunca o valor puro', async () => {
    await useCase.execute({
      userId: faker.database.mongodbObjectId(),
      purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
    });

    const [saved] = userTokenRepository.replacePending.mock.calls[0];
    expect(saved.tokenHash).toBe(generated.hash);
    expect(JSON.stringify(saved)).not.toContain(generated.token);
  });

  it.each([
    [UserTokenPurpose.EMAIL_CONFIRMATION, 24 * 3_600, '24 horas'],
    [UserTokenPurpose.EMAIL_CHANGE, 24 * 3_600, '24 horas'],
    [UserTokenPurpose.PASSWORD_RESET, 2 * 3_600, '2 horas'],
  ])(
    'dá a %s a validade configurada (%i segundos)',
    async (purpose, seconds, validity) => {
      const issued = await useCase.execute({
        userId: faker.database.mongodbObjectId(),
        purpose,
      });

      const expected = new Date(Date.now() + seconds * 1_000);
      expect(issued.expiresAt).toEqual(expected);
      expect(issued.validity).toBe(validity);
      expect(userTokenRepository.replacePending).toHaveBeenCalledWith(
        expect.objectContaining({ purpose, expiresAt: expected }),
      );
    },
  );

  it('registra o token para o usuário informado', async () => {
    const userId = faker.database.mongodbObjectId();

    await useCase.execute({
      userId,
      purpose: UserTokenPurpose.PASSWORD_RESET,
    });

    expect(userTokenRepository.replacePending).toHaveBeenCalledWith(
      expect.objectContaining({ userId }),
    );
  });

  it('guarda o novo e-mail cifrado na troca de e-mail', async () => {
    const pendingEmailEncrypted = faker.string.alphanumeric(64);

    await useCase.execute({
      userId: faker.database.mongodbObjectId(),
      purpose: UserTokenPurpose.EMAIL_CHANGE,
      pendingEmailEncrypted,
    });

    expect(userTokenRepository.replacePending).toHaveBeenCalledWith(
      expect.objectContaining({ pendingEmailEncrypted }),
    );
  });

  it.each([
    UserTokenPurpose.EMAIL_CONFIRMATION,
    UserTokenPurpose.PASSWORD_RESET,
  ])('ignora o e-mail pendente em %s', async (purpose) => {
    await useCase.execute({
      userId: faker.database.mongodbObjectId(),
      purpose,
      pendingEmailEncrypted: faker.string.alphanumeric(64),
    });

    const [saved] = userTokenRepository.replacePending.mock.calls[0];
    expect(saved.pendingEmailEncrypted).toBeUndefined();
  });

  it('não devolve o token se o registro falhar', async () => {
    userTokenRepository.replacePending.mockRejectedValue(
      new Error('banco fora do ar'),
    );

    await expect(
      useCase.execute({
        userId: faker.database.mongodbObjectId(),
        purpose: UserTokenPurpose.PASSWORD_RESET,
      }),
    ).rejects.toThrow('banco fora do ar');
  });
});
