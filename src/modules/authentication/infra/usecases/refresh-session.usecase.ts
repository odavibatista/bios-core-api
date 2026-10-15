import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionRevocationReason } from '@prisma/client';
import { UserRepository } from '@modules/accounts/domain/dtos/repositories/user.repository.js';
import type { Environment } from '@shared/config/environment.config.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { OpaqueTokenProvider } from '@shared/domain/providers/opaque-token.provider.js';
import { InvalidSessionException } from '../../domain/dtos/errors/invalid-session.exception.js';
import {
  type UserSessionLink,
  UserSessionRepository,
} from '../../domain/dtos/repositories/user-session.repository.js';
import type { AuthenticatedSession } from '../../domain/dtos/requests/session.dto.js';
import { AccessTokenProvider } from '../../domain/providers/access-token.provider.js';
import { truncateUserAgent } from '../../domain/user-agent.js';
import { SendSuspiciousLoginAlertUseCase } from './send-suspicious-login-alert.usecase.js';

/** Refresh token apresentado e a origem do pedido. */
export interface RefreshSessionCommand {
  refreshToken: string;

  /** IP de origem. */
  ip: string;

  userAgent?: string;
}

/**
 * Troca um refresh token válido por um novo par de tokens, com rotação de uso
 * único e detecção de reuso (UC17, RF32, NFSE05).
 *
 * A troca revoga o elo atual como `ROTATED` e cria o seguinte na mesma
 * família, em uma só operação atômica: dois pedidos com o mesmo token nunca
 * passam os dois. O papel do usuário no novo access token é o vigente na
 * renovação, não o do login.
 *
 * **Reuso é indício de vazamento.** Um refresh token já rotacionado só chega
 * outra vez se alguém guardou uma cópia: o usuário legítimo já usa o token
 * seguinte. Por isso reapresentá-lo — ou perder a disputa pelo mesmo token
 * contra outro pedido — revoga todas as sessões do usuário, de todos os
 * dispositivos, e avisa o titular por e-mail. Token expirado ou revogado por
 * outro motivo (logout, troca de senha) é só recusado, sem cascata: não há
 * indício de roubo, e derrubar as demais sessões puniria quem não fez nada.
 *
 * Todas as recusas dão a mesma resposta.
 *
 * @throws {InvalidSessionException} quando o token é desconhecido, expirou,
 * foi revogado ou reutilizado.
 */
@Injectable()
export class RefreshSessionUseCase extends UseCase<
  RefreshSessionCommand,
  AuthenticatedSession
> {
  private readonly logger = new Logger(RefreshSessionUseCase.name);

  constructor(
    private readonly userSessionRepository: UserSessionRepository,
    private readonly userRepository: UserRepository,
    private readonly opaqueTokenProvider: OpaqueTokenProvider,
    private readonly accessTokenProvider: AccessTokenProvider,
    private readonly encryptionProvider: EncryptionProvider,
    private readonly sendSuspiciousLoginAlertUseCase: SendSuspiciousLoginAlertUseCase,
    private readonly configService: ConfigService<Environment, true>,
  ) {
    super();
  }

  override async execute({
    refreshToken,
    ip,
    userAgent,
  }: RefreshSessionCommand): Promise<AuthenticatedSession> {
    const now = new Date();
    const link = await this.userSessionRepository.findByRefreshTokenHash(
      this.opaqueTokenProvider.hash(refreshToken),
    );

    if (!link) throw new InvalidSessionException();

    if (link.revocationReason === SessionRevocationReason.ROTATED) {
      await this.handleReuse(link, ip, now);
      throw new InvalidSessionException();
    }

    if (link.revokedAt || link.expiresAt <= now) {
      throw new InvalidSessionException();
    }

    const account = await this.userRepository.findProfileById(link.userId);

    if (!account?.isActive) throw new InvalidSessionException();

    const next = this.opaqueTokenProvider.generate();
    const lifetime = this.configService.get('AUTH_REFRESH_TOKEN_LIFETIME', {
      infer: true,
    });

    const nextSessionId = await this.userSessionRepository.rotate({
      currentSessionId: link.id,
      now,
      next: {
        userId: link.userId,
        familyId: link.familyId,
        refreshTokenHash: next.hash,
        ip,
        userAgent: truncateUserAgent(userAgent),
        expiresAt: new Date(now.getTime() + lifetime.toMilliseconds()),
      },
    });

    // O elo deixou de estar ativo entre a leitura e a troca: outro pedido com o
    // mesmo token chegou primeiro. É reuso (fluxo 4.1).
    if (nextSessionId === null) {
      await this.handleReuse(link, ip, now);
      throw new InvalidSessionException();
    }

    const access = this.accessTokenProvider.sign({
      userId: link.userId,
      sessionId: nextSessionId,
      role: account.role,
    });

    return {
      accessToken: access.token,
      refreshToken: next.token,
      expiresIn: access.expiresInSeconds,
      user: { id: account.id, name: account.name, role: account.role },
    };
  }

  /**
   * Derruba todas as sessões do usuário e avisa o titular (fluxo 3.1).
   *
   * A revogação é o que importa e acontece primeiro; o aviso é melhor esforço
   * e nunca altera a resposta ao chamador.
   */
  private async handleReuse(
    link: UserSessionLink,
    ip: string,
    occurredAt: Date,
  ): Promise<void> {
    await this.userSessionRepository.revokeAllActive(
      link.userId,
      SessionRevocationReason.REUSE_DETECTED,
      occurredAt,
    );

    try {
      const account = await this.userRepository.findProfileById(link.userId);

      if (!account) return;

      await this.sendSuspiciousLoginAlertUseCase.execute({
        userId: account.id,
        name: account.name,
        email: this.encryptionProvider.decrypt({
          ciphertext: account.emailEncrypted,
          keyVersion: account.encryptionKeyVersion,
        }),
        ip,
        occurredAt,
      });
    } catch (error) {
      this.logger.error(
        `Alerta de reuso de sessão não enviado para a conta ${link.userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
