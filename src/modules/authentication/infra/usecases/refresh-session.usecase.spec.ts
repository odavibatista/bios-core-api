import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SessionRevocationReason } from '@prisma/client';
import {
  type AccountProfile,
  UserRepository,
} from '@modules/accounts/domain/dtos/repositories/user.repository.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { OpaqueTokenProvider } from '@shared/domain/providers/opaque-token.provider.js';
import { Duration } from '@shared/domain/value-objects/duration.js';
import { faker } from '@test/support/faker.js';
import { InvalidSessionException } from '../../domain/dtos/errors/invalid-session.exception.js';
import {
  type UserSessionLink,
  UserSessionRepository,
} from '../../domain/dtos/repositories/user-session.repository.js';
import { AccessTokenProvider } from '../../domain/providers/access-token.provider.js';
import { RefreshSessionUseCase } from './refresh-session.usecase.js';
import { SendSuspiciousLoginAlertUseCase } from './send-suspicious-login-alert.usecase.js';

const REFRESH_LIFETIME = Duration.parse('7d');

describe('RefreshSessionUseCase', () => {
  const userSessionRepository = {
    findByRefreshTokenHash:
      vi.fn<UserSessionRepository['findByRefreshTokenHash']>(),
    rotate: vi.fn<UserSessionRepository['rotate']>(),
    revokeAllActive: vi.fn<UserSessionRepository['revokeAllActive']>(),
  };
  const userRepository = {
    findProfileById: vi.fn<UserRepository['findProfileById']>(),
  };
  const opaqueTokenProvider = {
    hash: vi.fn((token: string) => `h:${token}`),
    generate: vi.fn(),
  };
  const accessTokenProvider = { sign: vi.fn<AccessTokenProvider['sign']>() };
  const encryptionProvider = {
    decrypt: vi.fn<EncryptionProvider['decrypt']>(),
  };
  const sendSuspiciousLoginAlert = {
    execute: vi.fn<SendSuspiciousLoginAlertUseCase['execute']>(),
  };
  const nextRefreshToken = {
    token: faker.string.alphanumeric(43),
    hash: faker.string.hexadecimal({ length: 64, prefix: '' }),
  };
  const signedAccessToken = {
    token: faker.string.alphanumeric(120),
    expiresInSeconds: 900,
  };
  const nextSessionId = faker.database.mongodbObjectId();
  const holderEmail = faker.internet.email();
  let useCase: RefreshSessionUseCase;

  function buildLink(
    overrides: Partial<UserSessionLink> = {},
  ): UserSessionLink {
    return {
      id: faker.database.mongodbObjectId(),
      userId: faker.database.mongodbObjectId(),
      familyId: faker.string.uuid(),
      expiresAt: faker.date.soon({ days: 5 }),
      revokedAt: null,
      revocationReason: null,
      ...overrides,
    };
  }

  function buildProfile(
    userId: string,
    overrides: Partial<AccountProfile> = {},
  ): AccountProfile {
    return {
      id: userId,
      name: faker.person.fullName(),
      isActive: true,
      role: 'USER',
      emailEncrypted: faker.string.alphanumeric(40),
      addressEncrypted: null,
      encryptionKeyVersion: 1,
      ...overrides,
    };
  }

  function buildCommand(overrides = {}) {
    return {
      refreshToken: faker.string.alphanumeric(43),
      ip: faker.internet.ipv4(),
      userAgent: faker.internet.userAgent(),
      ...overrides,
    };
  }

  beforeEach(async () => {
    vi.useFakeTimers({ now: faker.date.recent() });
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    userSessionRepository.findByRefreshTokenHash.mockResolvedValue(null);
    userSessionRepository.rotate.mockResolvedValue(nextSessionId);
    userSessionRepository.revokeAllActive.mockResolvedValue(1);
    userRepository.findProfileById.mockImplementation((userId) =>
      Promise.resolve(buildProfile(userId)),
    );
    opaqueTokenProvider.generate.mockReturnValue(nextRefreshToken);
    accessTokenProvider.sign.mockReturnValue(signedAccessToken);
    encryptionProvider.decrypt.mockReturnValue(holderEmail);
    sendSuspiciousLoginAlert.execute.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RefreshSessionUseCase,
        { provide: UserSessionRepository, useValue: userSessionRepository },
        { provide: UserRepository, useValue: userRepository },
        { provide: OpaqueTokenProvider, useValue: opaqueTokenProvider },
        { provide: AccessTokenProvider, useValue: accessTokenProvider },
        { provide: EncryptionProvider, useValue: encryptionProvider },
        {
          provide: SendSuspiciousLoginAlertUseCase,
          useValue: sendSuspiciousLoginAlert,
        },
        { provide: ConfigService, useValue: { get: () => REFRESH_LIFETIME } },
      ],
    }).compile();

    useCase = moduleRef.get(RefreshSessionUseCase);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('refresh token ativo', () => {
    const link = buildLink();

    beforeEach(() => {
      userSessionRepository.findByRefreshTokenHash.mockResolvedValue(link);
    });

    it('procura o elo pelo resumo do refresh token, nunca pelo valor puro', async () => {
      const command = buildCommand();

      await useCase.execute(command);

      expect(userSessionRepository.findByRefreshTokenHash).toHaveBeenCalledWith(
        `h:${command.refreshToken}`,
      );
    });

    it('devolve o novo par de tokens e o dono da sessão', async () => {
      const profile = buildProfile(link.userId, { role: 'ADMIN' });
      userRepository.findProfileById.mockResolvedValue(profile);

      await expect(useCase.execute(buildCommand())).resolves.toEqual({
        accessToken: signedAccessToken.token,
        refreshToken: nextRefreshToken.token,
        expiresIn: signedAccessToken.expiresInSeconds,
        user: { id: profile.id, name: profile.name, role: 'ADMIN' },
      });
    });

    it('troca o elo atual pelo seguinte, na mesma família, com nova expiração', async () => {
      const command = buildCommand();

      await useCase.execute(command);

      expect(userSessionRepository.rotate).toHaveBeenCalledWith({
        currentSessionId: link.id,
        now: new Date(),
        next: {
          userId: link.userId,
          familyId: link.familyId,
          refreshTokenHash: nextRefreshToken.hash,
          ip: command.ip,
          userAgent: command.userAgent,
          expiresAt: new Date(Date.now() + REFRESH_LIFETIME.toMilliseconds()),
        },
      });
    });

    it('guarda só o resumo do novo refresh token', async () => {
      await useCase.execute(buildCommand());

      const [rotation] = userSessionRepository.rotate.mock.calls[0];
      expect(JSON.stringify(rotation)).not.toContain(nextRefreshToken.token);
    });

    it('assina o novo access token com a nova sessão e o papel vigente', async () => {
      userRepository.findProfileById.mockResolvedValue(
        buildProfile(link.userId, { role: 'ADMIN' }),
      );

      await useCase.execute(buildCommand());

      expect(accessTokenProvider.sign).toHaveBeenCalledWith({
        userId: link.userId,
        sessionId: nextSessionId,
        role: 'ADMIN',
      });
    });

    it('trunca user-agent longo demais', async () => {
      await useCase.execute(buildCommand({ userAgent: 'x'.repeat(5_000) }));

      const [rotation] = userSessionRepository.rotate.mock.calls[0];
      expect(rotation.next.userAgent).toHaveLength(512);
    });

    it('não revoga sessões nem envia alerta', async () => {
      await useCase.execute(buildCommand());

      expect(userSessionRepository.revokeAllActive).not.toHaveBeenCalled();
      expect(sendSuspiciousLoginAlert.execute).not.toHaveBeenCalled();
    });
  });

  describe('refresh token desconhecido', () => {
    it('recusa com a resposta genérica', async () => {
      userSessionRepository.findByRefreshTokenHash.mockResolvedValue(null);

      await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
        InvalidSessionException,
      );
    });

    it('não troca nada, não revoga nada e não alerta', async () => {
      await useCase.execute(buildCommand()).catch(() => undefined);

      expect(userSessionRepository.rotate).not.toHaveBeenCalled();
      expect(userSessionRepository.revokeAllActive).not.toHaveBeenCalled();
      expect(sendSuspiciousLoginAlert.execute).not.toHaveBeenCalled();
    });
  });

  describe('reuso de refresh token já rotacionado', () => {
    const link = buildLink({
      revokedAt: faker.date.recent(),
      revocationReason: SessionRevocationReason.ROTATED,
    });

    beforeEach(() => {
      userSessionRepository.findByRefreshTokenHash.mockResolvedValue(link);
    });

    it('recusa com a mesma resposta genérica', async () => {
      await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
        InvalidSessionException,
      );
    });

    it('revoga todas as sessões ativas do usuário como REUSE_DETECTED', async () => {
      await useCase.execute(buildCommand()).catch(() => undefined);

      expect(userSessionRepository.revokeAllActive).toHaveBeenCalledWith(
        link.userId,
        SessionRevocationReason.REUSE_DETECTED,
        new Date(),
      );
    });

    it('avisa o titular, pelo e-mail decifrado, com a origem do pedido', async () => {
      const command = buildCommand();
      const profile = buildProfile(link.userId, { encryptionKeyVersion: 3 });
      userRepository.findProfileById.mockResolvedValue(profile);

      await useCase.execute(command).catch(() => undefined);

      expect(encryptionProvider.decrypt).toHaveBeenCalledWith({
        ciphertext: profile.emailEncrypted,
        keyVersion: 3,
      });
      expect(sendSuspiciousLoginAlert.execute).toHaveBeenCalledWith({
        userId: profile.id,
        name: profile.name,
        email: holderEmail,
        ip: command.ip,
        occurredAt: new Date(),
      });
    });

    it('não emite novos tokens', async () => {
      await useCase.execute(buildCommand()).catch(() => undefined);

      expect(userSessionRepository.rotate).not.toHaveBeenCalled();
      expect(accessTokenProvider.sign).not.toHaveBeenCalled();
    });

    it('revoga as sessões antes de tentar avisar', async () => {
      await useCase.execute(buildCommand()).catch(() => undefined);

      expect(
        userSessionRepository.revokeAllActive.mock.invocationCallOrder[0],
      ).toBeLessThan(
        sendSuspiciousLoginAlert.execute.mock.invocationCallOrder[0],
      );
    });

    it('mantém a resposta genérica se o e-mail não puder ser decifrado', async () => {
      encryptionProvider.decrypt.mockImplementation(() => {
        throw new Error('chave ausente');
      });

      await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
        InvalidSessionException,
      );
      expect(userSessionRepository.revokeAllActive).toHaveBeenCalled();
      expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it('mantém a resposta genérica se a conta já não existir', async () => {
      userRepository.findProfileById.mockResolvedValue(null);

      await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
        InvalidSessionException,
      );
      expect(sendSuspiciousLoginAlert.execute).not.toHaveBeenCalled();
    });

    it('reapresentar um token rotacionado e já expirado também é reuso', async () => {
      userSessionRepository.findByRefreshTokenHash.mockResolvedValue(
        buildLink({
          expiresAt: faker.date.past(),
          revokedAt: faker.date.past(),
          revocationReason: SessionRevocationReason.ROTATED,
        }),
      );

      await useCase.execute(buildCommand()).catch(() => undefined);

      expect(userSessionRepository.revokeAllActive).toHaveBeenCalled();
    });
  });

  describe('disputa pelo mesmo token (renovação concorrente)', () => {
    const link = buildLink();

    beforeEach(() => {
      userSessionRepository.findByRefreshTokenHash.mockResolvedValue(link);
      userSessionRepository.rotate.mockResolvedValue(null);
    });

    it('trata como reuso: revoga tudo e avisa o titular', async () => {
      await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
        InvalidSessionException,
      );

      expect(userSessionRepository.revokeAllActive).toHaveBeenCalledWith(
        link.userId,
        SessionRevocationReason.REUSE_DETECTED,
        new Date(),
      );
      expect(sendSuspiciousLoginAlert.execute).toHaveBeenCalledOnce();
    });

    it('não emite tokens para quem perdeu a disputa', async () => {
      await useCase.execute(buildCommand()).catch(() => undefined);

      expect(accessTokenProvider.sign).not.toHaveBeenCalled();
    });
  });

  describe('recusas sem indício de roubo', () => {
    it.each([
      ['revogado por logout', SessionRevocationReason.LOGOUT],
      [
        'revogado em logout de todos os dispositivos',
        SessionRevocationReason.LOGOUT_ALL_DEVICES,
      ],
      ['revogado pela troca de senha', SessionRevocationReason.PASSWORD_CHANGE],
      [
        'revogado pela redefinição de senha',
        SessionRevocationReason.PASSWORD_RESET,
      ],
      ['revogado por reuso anterior', SessionRevocationReason.REUSE_DETECTED],
    ])('elo %s: só recusa, sem cascata', async (_case, reason) => {
      userSessionRepository.findByRefreshTokenHash.mockResolvedValue(
        buildLink({ revokedAt: faker.date.recent(), revocationReason: reason }),
      );

      await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
        InvalidSessionException,
      );

      expect(userSessionRepository.revokeAllActive).not.toHaveBeenCalled();
      expect(sendSuspiciousLoginAlert.execute).not.toHaveBeenCalled();
    });

    it('elo expirado: só recusa, sem cascata', async () => {
      userSessionRepository.findByRefreshTokenHash.mockResolvedValue(
        buildLink({ expiresAt: new Date(Date.now() - 1_000) }),
      );

      await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
        InvalidSessionException,
      );

      expect(userSessionRepository.revokeAllActive).not.toHaveBeenCalled();
      expect(userSessionRepository.rotate).not.toHaveBeenCalled();
    });

    it('elo que expira neste exato instante já não vale', async () => {
      userSessionRepository.findByRefreshTokenHash.mockResolvedValue(
        buildLink({ expiresAt: new Date() }),
      );

      await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
        InvalidSessionException,
      );
    });

    it.each([
      ['inexistente', null],
      ['não confirmada', 'inativa'],
    ])('conta %s: recusa sem trocar o elo', async (_case, state) => {
      const link = buildLink();
      userSessionRepository.findByRefreshTokenHash.mockResolvedValue(link);
      userRepository.findProfileById.mockResolvedValue(
        state === null ? null : buildProfile(link.userId, { isActive: false }),
      );

      await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
        InvalidSessionException,
      );

      expect(userSessionRepository.rotate).not.toHaveBeenCalled();
    });
  });
});
