import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserTokenPurpose } from '@prisma/client';
import type { Environment } from '@shared/config/environment.config.js';
import { OpaqueTokenProvider } from '@shared/domain/providers/opaque-token.provider.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { UserTokenRepository } from '../../domain/dtos/repositories/user-token.repository.js';

/** Pedido de um novo token de uso único. */
export interface IssueUserTokenRequest {
  /** Usuário que receberá o link. */
  userId: string;

  /** Para que o link serve. */
  purpose: UserTokenPurpose;

  /** Novo e-mail já cifrado; obrigatório na troca de e-mail (RF26), ignorado nas demais. */
  pendingEmailEncrypted?: string;
}

/** Token emitido, pronto para compor o link do e-mail. */
export interface IssuedUserToken {
  /** Valor puro do token. Só existe aqui: no banco fica apenas o resumo. */
  token: string;

  /** Momento em que o link deixa de valer. */
  expiresAt: Date;

  /** Validade por extenso (ex.: `2 horas`), no formato que os templates esperam. */
  validity: string;
}

/**
 * Variável de ambiente com a validade de cada finalidade.
 *
 * A troca de e-mail é uma confirmação como a do cadastro e segue o mesmo
 * prazo: o usuário a faz com o mesmo ritmo de quem abre a caixa de entrada.
 */
const LIFETIME_VARIABLES = {
  [UserTokenPurpose.EMAIL_CONFIRMATION]:
    'AUTH_EMAIL_CONFIRMATION_TOKEN_LIFETIME',
  [UserTokenPurpose.EMAIL_CHANGE]: 'AUTH_EMAIL_CONFIRMATION_TOKEN_LIFETIME',
  [UserTokenPurpose.PASSWORD_RESET]: 'AUTH_PASSWORD_RESET_TOKEN_LIFETIME',
} as const satisfies Record<UserTokenPurpose, keyof Environment>;

/**
 * Emite um token de uso único e validade limitada para um link de e-mail
 * (RF25, RF26, RF28).
 *
 * Emitir invalida os tokens pendentes da mesma finalidade: quem pede um novo
 * link (reenvio da confirmação, nova tentativa de recuperação) não deixa o
 * anterior circulando pela caixa de entrada.
 */
@Injectable()
export class IssueUserTokenUseCase extends UseCase<
  IssueUserTokenRequest,
  IssuedUserToken
> {
  constructor(
    private readonly userTokenRepository: UserTokenRepository,
    private readonly opaqueTokenProvider: OpaqueTokenProvider,
    private readonly configService: ConfigService<Environment, true>,
  ) {
    super();
  }

  override async execute({
    userId,
    purpose,
    pendingEmailEncrypted,
  }: IssueUserTokenRequest): Promise<IssuedUserToken> {
    const lifetime = this.configService.get(LIFETIME_VARIABLES[purpose], {
      infer: true,
    });
    const { token, hash } = this.opaqueTokenProvider.generate();
    const expiresAt = new Date(Date.now() + lifetime.toMilliseconds());

    await this.userTokenRepository.replacePending({
      userId,
      purpose,
      tokenHash: hash,
      expiresAt,
      pendingEmailEncrypted:
        purpose === UserTokenPurpose.EMAIL_CHANGE
          ? pendingEmailEncrypted
          : undefined,
    });

    return { token, expiresAt, validity: lifetime.toLongText() };
  }
}
