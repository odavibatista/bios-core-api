import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccessBlockReason,
  AccessBlockScope,
  LoginFailureReason,
} from '@prisma/client';
import { UserRepository } from '@modules/accounts/domain/dtos/repositories/user.repository.js';
import type { AccountCredentials } from '@modules/accounts/domain/dtos/repositories/user.repository.js';
import { AccessBlockedException } from '@modules/security/domain/dtos/errors/access-blocked.exception.js';
import {
  type AccessBlockTarget,
  AccessBlockRepository,
} from '@modules/security/domain/dtos/repositories/access-block.repository.js';
import type { Environment } from '@shared/config/environment.config.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import {
  type EncryptedValue,
  EncryptionProvider,
} from '@shared/domain/providers/encryption.provider.js';
import { OpaqueTokenProvider } from '@shared/domain/providers/opaque-token.provider.js';
import { PasswordProvider } from '@shared/domain/providers/password.provider.js';
import { normalizeEmail } from '@shared/domain/value-objects/email-address.js';
import { AccountNotConfirmedException } from '../../domain/dtos/errors/account-not-confirmed.exception.js';
import { InvalidCredentialsException } from '../../domain/dtos/errors/invalid-credentials.exception.js';
import { LoginAttemptRepository } from '../../domain/dtos/repositories/login-attempt.repository.js';
import { UserSessionRepository } from '../../domain/dtos/repositories/user-session.repository.js';
import {
  LOGIN_BLOCK_DURATION,
  MAX_CONSECUTIVE_LOGIN_FAILURES,
} from '../../domain/login-protection.js';
import { AccessTokenProvider } from '../../domain/providers/access-token.provider.js';
import type { AuthenticatedSession } from '../../domain/dtos/requests/session.dto.js';
import { truncateUserAgent } from '../../domain/user-agent.js';
import { SendSuspiciousLoginAlertUseCase } from './send-suspicious-login-alert.usecase.js';

/** Credenciais e origem da tentativa. */
export interface LoginCommand {
  email: string;
  password: string;

  /** IP de origem. */
  ip: string;

  userAgent?: string;
}

/**
 * Autentica o usuário e abre uma sessão (UC02, RF02, RF19, RF20).
 *
 * Fluxo: recusa IP ou conta bloqueados; confere a senha; registra a tentativa;
 * e, conforme o resultado, abre uma sessão nova (uma família de rotação por
 * login, isto é, por dispositivo) ou conta a falha e bloqueia quem chegou ao
 * limite.
 *
 * **O erro não distingue e-mail inexistente de senha errada**, nem no tempo:
 * para e-mail desconhecido a senha é conferida contra um hash descartável,
 * com o mesmo custo de uma conferência real.
 *
 * **O bloqueio vale para IP e para conta.** Cada alvo acumula as próprias
 * falhas; o primeiro a chegar a cinco é bloqueado por 15 minutos. Quando é a
 * conta, o titular recebe o alerta de login suspeito. Um limite conhecido: o
 * bloqueio de conta só existe para e-mail cadastrado, então, depois de cinco
 * falhas vindas de IPs diferentes, a resposta de bloqueio denuncia que a conta
 * existe. O bloqueio por IP, que vale também para e-mail desconhecido, limita
 * esse teste a quem controla muitos endereços.
 *
 * @throws {AccessBlockedException} quando o IP ou a conta está bloqueado.
 * @throws {InvalidCredentialsException} quando e-mail ou senha estão incorretos.
 * @throws {AccountNotConfirmedException} quando a senha confere, mas o e-mail
 * da conta ainda não foi confirmado.
 */
@Injectable()
export class LoginUseCase extends UseCase<LoginCommand, AuthenticatedSession> {
  private decoyPassword?: Promise<EncryptedValue>;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly encryptionProvider: EncryptionProvider,
    private readonly passwordProvider: PasswordProvider,
    private readonly opaqueTokenProvider: OpaqueTokenProvider,
    private readonly accessTokenProvider: AccessTokenProvider,
    private readonly accessBlockRepository: AccessBlockRepository,
    private readonly loginAttemptRepository: LoginAttemptRepository,
    private readonly userSessionRepository: UserSessionRepository,
    private readonly sendSuspiciousLoginAlertUseCase: SendSuspiciousLoginAlertUseCase,
    private readonly configService: ConfigService<Environment, true>,
  ) {
    super();
  }

  override async execute({
    email,
    password,
    ip,
    userAgent,
  }: LoginCommand): Promise<AuthenticatedSession> {
    const now = new Date();
    const normalizedEmail = normalizeEmail(email);
    const account = await this.userRepository.findCredentialsByEmailHash(
      this.encryptionProvider.blindIndex(normalizedEmail),
    );

    await this.assertNotBlocked(ip, account, now);

    // Roda mesmo sem conta (contra um hash descartável), para igualar o tempo.
    const passwordMatches = await this.checkPassword(password, account);

    if (!account || !passwordMatches) {
      await this.loginAttemptRepository.recordFailure({
        userId: account?.id,
        ip,
        reason: LoginFailureReason.INVALID_CREDENTIALS,
      });
      await this.blockWhoReachedTheLimit(ip, account, normalizedEmail, now);

      throw new InvalidCredentialsException();
    }

    if (!account.isActive) {
      await this.loginAttemptRepository.recordFailure({
        userId: account.id,
        ip,
        reason: LoginFailureReason.ACCOUNT_INACTIVE,
      });

      throw new AccountNotConfirmedException();
    }

    await this.loginAttemptRepository.recordSuccess({ userId: account.id, ip });

    return this.openSession(account, ip, userAgent, now);
  }

  /** Recusa a tentativa de quem está bloqueado, registrando-a (RF19). */
  private async assertNotBlocked(
    ip: string,
    account: AccountCredentials | null,
    now: Date,
  ): Promise<void> {
    const block = await this.accessBlockRepository.findActive(
      targetsOf(ip, account),
      now,
    );

    if (!block) return;

    await this.loginAttemptRepository.recordFailure({
      userId: account?.id,
      ip,
      reason: LoginFailureReason.ACCESS_BLOCKED,
    });

    throw new AccessBlockedException(
      block.blockedUntil === null
        ? null
        : Math.max(
            1,
            Math.ceil((block.blockedUntil.getTime() - now.getTime()) / 1_000),
          ),
    );
  }

  /**
   * Confere a senha. Sem conta, confere contra um hash descartável e devolve
   * `false`: o custo do bcrypt é o mesmo nos dois caminhos.
   */
  private async checkPassword(
    password: string,
    account: AccountCredentials | null,
  ): Promise<boolean> {
    if (account) {
      return this.passwordProvider.verify(password, {
        ciphertext: account.passwordEncrypted,
        keyVersion: account.encryptionKeyVersion,
      });
    }

    await this.passwordProvider.verify(password, await this.decoy());

    return false;
  }

  /** Hash de uma senha sorteada, criado uma vez e reaproveitado. */
  private decoy(): Promise<EncryptedValue> {
    this.decoyPassword ??= this.passwordProvider
      .hash(randomUUID())
      .catch((error: unknown) => {
        // Uma falha não pode ficar em cache: o próximo login tenta de novo.
        this.decoyPassword = undefined;
        throw error;
      });

    return this.decoyPassword;
  }

  /**
   * Bloqueia o IP e/ou a conta que acabaram de chegar ao limite de falhas
   * consecutivas (RF20) e avisa o titular quando o bloqueio é da conta.
   */
  private async blockWhoReachedTheLimit(
    ip: string,
    account: AccountCredentials | null,
    email: string,
    now: Date,
  ): Promise<void> {
    for (const target of targetsOf(ip, account)) {
      const failures =
        await this.loginAttemptRepository.countFailuresSinceLastSuccess(
          target,
          await this.accessBlockRepository.findLastLoginBlockStart(target),
        );

      if (failures < MAX_CONSECUTIVE_LOGIN_FAILURES) continue;

      await this.accessBlockRepository.create({
        target,
        reason: AccessBlockReason.LOGIN_ATTEMPTS,
        blockedUntil: new Date(
          now.getTime() + LOGIN_BLOCK_DURATION.toMilliseconds(),
        ),
      });

      if (target.scope === AccessBlockScope.USER && account) {
        await this.sendSuspiciousLoginAlertUseCase.execute({
          userId: account.id,
          name: account.name,
          email,
          ip,
          occurredAt: now,
        });
      }
    }
  }

  /** Abre uma sessão nova: família de rotação própria e par de tokens. */
  private async openSession(
    account: AccountCredentials,
    ip: string,
    userAgent: string | undefined,
    now: Date,
  ): Promise<AuthenticatedSession> {
    const refresh = this.opaqueTokenProvider.generate();
    const refreshLifetime = this.configService.get(
      'AUTH_REFRESH_TOKEN_LIFETIME',
      { infer: true },
    );

    const sessionId = await this.userSessionRepository.create({
      userId: account.id,
      familyId: randomUUID(),
      refreshTokenHash: refresh.hash,
      ip,
      userAgent: truncateUserAgent(userAgent),
      expiresAt: new Date(now.getTime() + refreshLifetime.toMilliseconds()),
    });
    const access = this.accessTokenProvider.sign({
      userId: account.id,
      sessionId,
      role: account.role,
    });

    await this.userRepository.recordLogin(account.id, now);

    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: access.expiresInSeconds,
      user: { id: account.id, name: account.name, role: account.role },
    };
  }
}

/** Alvos que acumulam falhas e recebem bloqueio: o IP e, se existir, a conta. */
function targetsOf(
  ip: string,
  account: AccountCredentials | null,
): AccessBlockTarget[] {
  const targets: AccessBlockTarget[] = [{ scope: AccessBlockScope.IP, ip }];

  if (account) {
    targets.push({ scope: AccessBlockScope.USER, userId: account.id });
  }

  return targets;
}
