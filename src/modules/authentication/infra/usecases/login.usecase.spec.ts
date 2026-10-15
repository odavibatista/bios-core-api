import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AccessBlockReason,
  AccessBlockScope,
  LoginFailureReason,
} from '@prisma/client';
import { UserRepository } from '@modules/accounts/domain/dtos/repositories/user.repository.js';
import { AccessBlockedException } from '@modules/security/domain/dtos/errors/access-blocked.exception.js';
import { AccessBlockRepository } from '@modules/security/domain/dtos/repositories/access-block.repository.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { OpaqueTokenProvider } from '@shared/domain/providers/opaque-token.provider.js';
import { PasswordProvider } from '@shared/domain/providers/password.provider.js';
import { Duration } from '@shared/domain/value-objects/duration.js';
import { accountCredentialsFactory } from '@test/factories/accounts/account-credentials.factory.js';
import { buildPassword } from '@test/factories/shared/password.factory.js';
import { faker } from '@test/support/faker.js';
import { AccountNotConfirmedException } from '../../domain/dtos/errors/account-not-confirmed.exception.js';
import { InvalidCredentialsException } from '../../domain/dtos/errors/invalid-credentials.exception.js';
import { LoginAttemptRepository } from '../../domain/dtos/repositories/login-attempt.repository.js';
import { UserSessionRepository } from '../../domain/dtos/repositories/user-session.repository.js';
import { AccessTokenProvider } from '../../domain/providers/access-token.provider.js';
import { LoginUseCase } from './login.usecase.js';
import { SendSuspiciousLoginAlertUseCase } from './send-suspicious-login-alert.usecase.js';

const REFRESH_LIFETIME = Duration.parse('7d');
const LOGIN_BLOCK_MS = 15 * 60 * 1_000;

describe('LoginUseCase', () => {
  const userRepository = {
    findCredentialsByEmailHash:
      vi.fn<UserRepository['findCredentialsByEmailHash']>(),
    recordLogin: vi.fn<UserRepository['recordLogin']>(),
  };
  const encryptionProvider = {
    blindIndex: vi.fn<EncryptionProvider['blindIndex']>(),
  };
  const passwordProvider = {
    verify: vi.fn<PasswordProvider['verify']>(),
    hash: vi.fn<PasswordProvider['hash']>(),
  };
  const opaqueTokenProvider = {
    generate: vi.fn<OpaqueTokenProvider['generate']>(),
  };
  const accessTokenProvider = { sign: vi.fn<AccessTokenProvider['sign']>() };
  const accessBlockRepository = {
    findActive: vi.fn<AccessBlockRepository['findActive']>(),
    create: vi.fn<AccessBlockRepository['create']>(),
    findLastLoginBlockStart:
      vi.fn<AccessBlockRepository['findLastLoginBlockStart']>(),
  };
  const loginAttemptRepository = {
    recordFailure: vi.fn<LoginAttemptRepository['recordFailure']>(),
    recordSuccess: vi.fn<LoginAttemptRepository['recordSuccess']>(),
    countFailuresSinceLastSuccess:
      vi.fn<LoginAttemptRepository['countFailuresSinceLastSuccess']>(),
  };
  const userSessionRepository = {
    create: vi.fn<UserSessionRepository['create']>(),
  };
  const sendSuspiciousLoginAlert = {
    execute: vi.fn<SendSuspiciousLoginAlertUseCase['execute']>(),
  };
  const refreshToken = {
    token: faker.string.alphanumeric(43),
    hash: faker.string.hexadecimal({ length: 64, prefix: '' }),
  };
  const sessionId = faker.database.mongodbObjectId();
  const signedAccessToken = {
    token: faker.string.alphanumeric(120),
    expiresInSeconds: 900,
  };
  const decoyHash = {
    ciphertext: faker.string.alphanumeric(60),
    keyVersion: 1,
  };
  let useCase: LoginUseCase;

  function buildCommand(overrides = {}) {
    return {
      email: faker.internet.email(),
      password: buildPassword(),
      ip: faker.internet.ipv4(),
      userAgent: faker.internet.userAgent(),
      ...overrides,
    };
  }

  /** Leva as falhas contadas do IP e/ou da conta ao valor desejado. */
  function givenFailures({ ip = 0, user = 0 }: { ip?: number; user?: number }) {
    loginAttemptRepository.countFailuresSinceLastSuccess.mockImplementation(
      (target) =>
        Promise.resolve(target.scope === AccessBlockScope.IP ? ip : user),
    );
  }

  beforeEach(async () => {
    vi.useFakeTimers({ now: faker.date.recent() });

    userRepository.findCredentialsByEmailHash.mockResolvedValue(null);
    userRepository.recordLogin.mockResolvedValue(undefined);
    encryptionProvider.blindIndex.mockImplementation((value) => `idx:${value}`);
    passwordProvider.verify.mockResolvedValue(true);
    passwordProvider.hash.mockResolvedValue(decoyHash);
    opaqueTokenProvider.generate.mockReturnValue(refreshToken);
    accessTokenProvider.sign.mockReturnValue(signedAccessToken);
    accessBlockRepository.findActive.mockResolvedValue(null);
    accessBlockRepository.create.mockResolvedValue(undefined);
    accessBlockRepository.findLastLoginBlockStart.mockResolvedValue(null);
    loginAttemptRepository.recordFailure.mockResolvedValue(undefined);
    loginAttemptRepository.recordSuccess.mockResolvedValue(undefined);
    givenFailures({});
    userSessionRepository.create.mockResolvedValue(sessionId);
    sendSuspiciousLoginAlert.execute.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        LoginUseCase,
        { provide: UserRepository, useValue: userRepository },
        { provide: EncryptionProvider, useValue: encryptionProvider },
        { provide: PasswordProvider, useValue: passwordProvider },
        { provide: OpaqueTokenProvider, useValue: opaqueTokenProvider },
        { provide: AccessTokenProvider, useValue: accessTokenProvider },
        { provide: AccessBlockRepository, useValue: accessBlockRepository },
        { provide: LoginAttemptRepository, useValue: loginAttemptRepository },
        { provide: UserSessionRepository, useValue: userSessionRepository },
        {
          provide: SendSuspiciousLoginAlertUseCase,
          useValue: sendSuspiciousLoginAlert,
        },
        {
          provide: ConfigService,
          useValue: { get: () => REFRESH_LIFETIME },
        },
      ],
    }).compile();

    useCase = moduleRef.get(LoginUseCase);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('credenciais válidas', () => {
    const account = accountCredentialsFactory.build({ isActive: true });

    beforeEach(() => {
      userRepository.findCredentialsByEmailHash.mockResolvedValue(account);
    });

    it('devolve o par de tokens e o usuário', async () => {
      await expect(useCase.execute(buildCommand())).resolves.toEqual({
        accessToken: signedAccessToken.token,
        refreshToken: refreshToken.token,
        expiresIn: signedAccessToken.expiresInSeconds,
        user: { id: account.id, name: account.name, role: account.role },
      });
    });

    it('confere a senha contra o valor guardado, com a versão da chave', async () => {
      const command = buildCommand();

      await useCase.execute(command);

      expect(passwordProvider.verify).toHaveBeenCalledWith(command.password, {
        ciphertext: account.passwordEncrypted,
        keyVersion: account.encryptionKeyVersion,
      });
    });

    it('localiza a conta pelo índice cego do e-mail normalizado', async () => {
      const email = faker.internet.email().toLowerCase();

      await useCase.execute(
        buildCommand({ email: `  ${email.toUpperCase()} ` }),
      );

      expect(userRepository.findCredentialsByEmailHash).toHaveBeenCalledWith(
        `idx:${email}`,
      );
    });

    it('abre uma sessão nova, guardando só o resumo do refresh token', async () => {
      const command = buildCommand();

      await useCase.execute(command);

      expect(userSessionRepository.create).toHaveBeenCalledWith({
        userId: account.id,
        familyId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        refreshTokenHash: refreshToken.hash,
        ip: command.ip,
        userAgent: command.userAgent,
        expiresAt: new Date(Date.now() + REFRESH_LIFETIME.toMilliseconds()),
      });
      const [saved] = userSessionRepository.create.mock.calls[0];
      expect(JSON.stringify(saved)).not.toContain(refreshToken.token);
    });

    it('dá uma família de rotação própria a cada login', async () => {
      await useCase.execute(buildCommand());
      await useCase.execute(buildCommand());

      const [first, second] = userSessionRepository.create.mock.calls.map(
        ([session]) => session.familyId,
      );
      expect(first).not.toBe(second);
    });

    it('assina o access token com o usuário, a sessão e o papel', async () => {
      await useCase.execute(buildCommand());

      expect(accessTokenProvider.sign).toHaveBeenCalledWith({
        userId: account.id,
        sessionId,
        role: account.role,
      });
    });

    it('trunca user-agent longo demais', async () => {
      await useCase.execute(buildCommand({ userAgent: 'x'.repeat(5_000) }));

      const [saved] = userSessionRepository.create.mock.calls[0];
      expect(saved.userAgent).toHaveLength(512);
    });

    it('aceita requisição sem user-agent', async () => {
      await useCase.execute(buildCommand({ userAgent: undefined }));

      const [saved] = userSessionRepository.create.mock.calls[0];
      expect(saved.userAgent).toBeUndefined();
    });

    it('registra a tentativa bem-sucedida e o último login', async () => {
      const command = buildCommand();

      await useCase.execute(command);

      expect(loginAttemptRepository.recordSuccess).toHaveBeenCalledWith({
        userId: account.id,
        ip: command.ip,
      });
      expect(userRepository.recordLogin).toHaveBeenCalledWith(
        account.id,
        new Date(),
      );
      expect(loginAttemptRepository.recordFailure).not.toHaveBeenCalled();
    });

    it('não conta falhas, não bloqueia e não envia alerta', async () => {
      await useCase.execute(buildCommand());

      expect(
        loginAttemptRepository.countFailuresSinceLastSuccess,
      ).not.toHaveBeenCalled();
      expect(accessBlockRepository.create).not.toHaveBeenCalled();
      expect(sendSuspiciousLoginAlert.execute).not.toHaveBeenCalled();
    });

    it('não abre sessão se o registro da tentativa falhar', async () => {
      loginAttemptRepository.recordSuccess.mockRejectedValue(
        new Error('banco'),
      );

      await expect(useCase.execute(buildCommand())).rejects.toThrow('banco');
      expect(userSessionRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('senha incorreta', () => {
    const account = accountCredentialsFactory.build({ isActive: true });

    beforeEach(() => {
      userRepository.findCredentialsByEmailHash.mockResolvedValue(account);
      passwordProvider.verify.mockResolvedValue(false);
    });

    it('recusa com a mensagem genérica de credenciais inválidas', async () => {
      await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
        InvalidCredentialsException,
      );
    });

    it('registra a falha na conta visada e no IP', async () => {
      const command = buildCommand();

      await useCase.execute(command).catch(() => undefined);

      expect(loginAttemptRepository.recordFailure).toHaveBeenCalledWith({
        userId: account.id,
        ip: command.ip,
        reason: LoginFailureReason.INVALID_CREDENTIALS,
      });
    });

    it('não abre sessão nem registra último login', async () => {
      await useCase.execute(buildCommand()).catch(() => undefined);

      expect(userSessionRepository.create).not.toHaveBeenCalled();
      expect(userRepository.recordLogin).not.toHaveBeenCalled();
      expect(loginAttemptRepository.recordSuccess).not.toHaveBeenCalled();
    });
  });

  describe('e-mail sem conta', () => {
    it('recusa com o mesmo erro da senha incorreta', async () => {
      await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
        InvalidCredentialsException,
      );
    });

    it('registra a falha sem conta, só com o IP', async () => {
      const command = buildCommand();

      await useCase.execute(command).catch(() => undefined);

      expect(loginAttemptRepository.recordFailure).toHaveBeenCalledWith({
        userId: undefined,
        ip: command.ip,
        reason: LoginFailureReason.INVALID_CREDENTIALS,
      });
    });

    it('confere a senha contra um hash descartável, para igualar o tempo de resposta', async () => {
      const command = buildCommand();

      await useCase.execute(command).catch(() => undefined);

      expect(passwordProvider.verify).toHaveBeenCalledWith(
        command.password,
        decoyHash,
      );
    });

    it('cria o hash descartável uma única vez', async () => {
      await useCase.execute(buildCommand()).catch(() => undefined);
      await useCase.execute(buildCommand()).catch(() => undefined);

      expect(passwordProvider.hash).toHaveBeenCalledOnce();
    });

    it('tenta de novo o hash descartável depois de uma falha ao criá-lo', async () => {
      passwordProvider.hash.mockRejectedValueOnce(new Error('indisponível'));

      await expect(useCase.execute(buildCommand())).rejects.toThrow(
        'indisponível',
      );
      await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
        InvalidCredentialsException,
      );
    });
  });

  describe('conta ainda não confirmada', () => {
    const account = accountCredentialsFactory.build({ isActive: false });

    beforeEach(() => {
      userRepository.findCredentialsByEmailHash.mockResolvedValue(account);
    });

    it('avisa quem acertou a senha de que falta confirmar o e-mail', async () => {
      passwordProvider.verify.mockResolvedValue(true);

      await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
        AccountNotConfirmedException,
      );
    });

    it('registra o motivo e não abre sessão', async () => {
      const command = buildCommand();

      await useCase.execute(command).catch(() => undefined);

      expect(loginAttemptRepository.recordFailure).toHaveBeenCalledWith({
        userId: account.id,
        ip: command.ip,
        reason: LoginFailureReason.ACCOUNT_INACTIVE,
      });
      expect(userSessionRepository.create).not.toHaveBeenCalled();
    });

    it('não conta como erro de senha: não bloqueia', async () => {
      await useCase.execute(buildCommand()).catch(() => undefined);

      expect(accessBlockRepository.create).not.toHaveBeenCalled();
    });

    it('não revela a conta a quem errou a senha', async () => {
      passwordProvider.verify.mockResolvedValue(false);

      await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
        InvalidCredentialsException,
      );
    });
  });

  describe('acesso bloqueado', () => {
    const account = accountCredentialsFactory.build({ isActive: true });

    beforeEach(() => {
      userRepository.findCredentialsByEmailHash.mockResolvedValue(account);
      accessBlockRepository.findActive.mockResolvedValue({
        blockedUntil: new Date(Date.now() + 300_500),
      });
    });

    it('recusa informando quanto falta, arredondado para cima', async () => {
      const attempt = useCase.execute(buildCommand());

      await expect(attempt).rejects.toBeInstanceOf(AccessBlockedException);
      await expect(attempt).rejects.toMatchObject({
        code: 'ACCESS_TEMPORARILY_BLOCKED',
        details: { retry_after_seconds: 301 },
      });
    });

    it('não informa prazo quando o bloqueio não tem fim', async () => {
      accessBlockRepository.findActive.mockResolvedValue({
        blockedUntil: null,
      });

      await expect(useCase.execute(buildCommand())).rejects.toMatchObject({
        details: undefined,
      });
    });

    it('consulta o bloqueio do IP e da conta', async () => {
      const command = buildCommand();

      await useCase.execute(command).catch(() => undefined);

      expect(accessBlockRepository.findActive).toHaveBeenCalledWith(
        [
          { scope: AccessBlockScope.IP, ip: command.ip },
          { scope: AccessBlockScope.USER, userId: account.id },
        ],
        new Date(),
      );
    });

    it('consulta só o IP quando o e-mail não tem conta', async () => {
      userRepository.findCredentialsByEmailHash.mockResolvedValue(null);
      const command = buildCommand();

      await useCase.execute(command).catch(() => undefined);

      expect(accessBlockRepository.findActive).toHaveBeenCalledWith(
        [{ scope: AccessBlockScope.IP, ip: command.ip }],
        new Date(),
      );
    });

    it('registra a tentativa recusada', async () => {
      const command = buildCommand();

      await useCase.execute(command).catch(() => undefined);

      expect(loginAttemptRepository.recordFailure).toHaveBeenCalledWith({
        userId: account.id,
        ip: command.ip,
        reason: LoginFailureReason.ACCESS_BLOCKED,
      });
    });

    it('nem confere a senha: a senha certa não libera quem está bloqueado', async () => {
      passwordProvider.verify.mockResolvedValue(true);

      await useCase.execute(buildCommand()).catch(() => undefined);

      expect(passwordProvider.verify).not.toHaveBeenCalled();
      expect(userSessionRepository.create).not.toHaveBeenCalled();
    });

    it('não conta a tentativa recusada como nova falha', async () => {
      await useCase.execute(buildCommand()).catch(() => undefined);

      expect(
        loginAttemptRepository.countFailuresSinceLastSuccess,
      ).not.toHaveBeenCalled();
      expect(accessBlockRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('bloqueio por falhas consecutivas', () => {
    const account = accountCredentialsFactory.build({ isActive: true });

    beforeEach(() => {
      userRepository.findCredentialsByEmailHash.mockResolvedValue(account);
      passwordProvider.verify.mockResolvedValue(false);
    });

    it('não bloqueia até a quinta falha', async () => {
      givenFailures({ ip: 4, user: 4 });

      await useCase.execute(buildCommand()).catch(() => undefined);

      expect(accessBlockRepository.create).not.toHaveBeenCalled();
      expect(sendSuspiciousLoginAlert.execute).not.toHaveBeenCalled();
    });

    it('na quinta falha, ainda responde credenciais inválidas', async () => {
      givenFailures({ ip: 5, user: 5 });

      await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
        InvalidCredentialsException,
      );
    });

    it('bloqueia a conta por 15 minutos', async () => {
      givenFailures({ ip: 1, user: 5 });

      await useCase.execute(buildCommand()).catch(() => undefined);

      expect(accessBlockRepository.create).toHaveBeenCalledOnce();
      expect(accessBlockRepository.create).toHaveBeenCalledWith({
        target: { scope: AccessBlockScope.USER, userId: account.id },
        reason: AccessBlockReason.LOGIN_ATTEMPTS,
        blockedUntil: new Date(Date.now() + LOGIN_BLOCK_MS),
      });
    });

    it('bloqueia o IP por 15 minutos', async () => {
      const command = buildCommand();
      givenFailures({ ip: 5, user: 1 });

      await useCase.execute(command).catch(() => undefined);

      expect(accessBlockRepository.create).toHaveBeenCalledOnce();
      expect(accessBlockRepository.create).toHaveBeenCalledWith({
        target: { scope: AccessBlockScope.IP, ip: command.ip },
        reason: AccessBlockReason.LOGIN_ATTEMPTS,
        blockedUntil: new Date(Date.now() + LOGIN_BLOCK_MS),
      });
    });

    it('bloqueia os dois quando ambos chegam ao limite, e avisa o titular uma só vez', async () => {
      givenFailures({ ip: 5, user: 5 });

      await useCase.execute(buildCommand()).catch(() => undefined);

      expect(accessBlockRepository.create).toHaveBeenCalledTimes(2);
      expect(sendSuspiciousLoginAlert.execute).toHaveBeenCalledOnce();
    });

    it('recomeça a contagem a partir do último bloqueio do alvo', async () => {
      const lastBlock = faker.date.recent();
      accessBlockRepository.findLastLoginBlockStart.mockResolvedValue(
        lastBlock,
      );

      await useCase.execute(buildCommand()).catch(() => undefined);

      for (const [, notBefore] of loginAttemptRepository
        .countFailuresSinceLastSuccess.mock.calls) {
        expect(notBefore).toBe(lastBlock);
      }
      expect(
        loginAttemptRepository.countFailuresSinceLastSuccess,
      ).toHaveBeenCalledTimes(2);
    });

    it('alerta o titular, pelo e-mail normalizado, quando a conta é bloqueada', async () => {
      const command = buildCommand({ email: ' Titular@Exemplo.com ' });
      givenFailures({ user: 5 });

      await useCase.execute(command).catch(() => undefined);

      expect(sendSuspiciousLoginAlert.execute).toHaveBeenCalledWith({
        userId: account.id,
        name: account.name,
        email: 'titular@exemplo.com',
        ip: command.ip,
        occurredAt: new Date(),
      });
    });

    it('não alerta ninguém quando só o IP é bloqueado', async () => {
      givenFailures({ ip: 5, user: 0 });

      await useCase.execute(buildCommand()).catch(() => undefined);

      expect(sendSuspiciousLoginAlert.execute).not.toHaveBeenCalled();
    });

    it('bloqueia só o IP e não alerta quando o e-mail não tem conta', async () => {
      userRepository.findCredentialsByEmailHash.mockResolvedValue(null);
      const command = buildCommand();
      givenFailures({ ip: 5 });

      await useCase.execute(command).catch(() => undefined);

      expect(accessBlockRepository.create).toHaveBeenCalledOnce();
      expect(accessBlockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { scope: AccessBlockScope.IP, ip: command.ip },
        }),
      );
      expect(sendSuspiciousLoginAlert.execute).not.toHaveBeenCalled();
    });

    it('conta a falha antes de decidir o bloqueio', async () => {
      await useCase.execute(buildCommand()).catch(() => undefined);

      expect(
        loginAttemptRepository.recordFailure.mock.invocationCallOrder[0],
      ).toBeLessThan(
        loginAttemptRepository.countFailuresSinceLastSuccess.mock
          .invocationCallOrder[0],
      );
    });
  });
});
