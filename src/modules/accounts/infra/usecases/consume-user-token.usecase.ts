import { Injectable } from '@nestjs/common';
import type { UserTokenPurpose } from '@prisma/client';
import { OpaqueTokenProvider } from '@shared/domain/providers/opaque-token.provider.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { InvalidUserTokenException } from '../../domain/dtos/errors/invalid-user-token.exception.js';
import { UserTokenRepository } from '../../domain/dtos/repositories/user-token.repository.js';

/** Token apresentado pelo usuário e a ação para a qual ele o apresenta. */
export interface ConsumeUserTokenRequest {
  /** Valor puro, como veio no link do e-mail. */
  token: string;

  /** Finalidade esperada: um link de confirmação não redefine senha. */
  purpose: UserTokenPurpose;
}

/** O que o token autorizou. */
export interface ConsumedUserToken {
  /** Usuário dono do token. */
  userId: string;

  /** Novo e-mail cifrado, presente apenas na troca de e-mail (RF26). */
  pendingEmailEncrypted: string | null;
}

/**
 * Consome um token de uso único (RF25, RF26, RF28).
 *
 * O token é gasto aqui, antes de a ação autorizada acontecer: se a ação
 * falhar depois (ex.: nova senha fraca demais), o link já foi usado e o
 * usuário pede outro. É o preço de garantir uso único sem janela de
 * repetição; o contrário permitiria reaproveitar um link já gasto.
 *
 * @throws {InvalidUserTokenException} quando o token é desconhecido, expirou,
 * já foi usado ou é de outra finalidade.
 */
@Injectable()
export class ConsumeUserTokenUseCase extends UseCase<
  ConsumeUserTokenRequest,
  ConsumedUserToken
> {
  constructor(
    private readonly userTokenRepository: UserTokenRepository,
    private readonly opaqueTokenProvider: OpaqueTokenProvider,
  ) {
    super();
  }

  override async execute({
    token,
    purpose,
  }: ConsumeUserTokenRequest): Promise<ConsumedUserToken> {
    const consumed = await this.userTokenRepository.consume({
      tokenHash: this.opaqueTokenProvider.hash(token),
      purpose,
      now: new Date(),
    });

    if (!consumed) throw new InvalidUserTokenException();

    return {
      userId: consumed.user_id,
      pendingEmailEncrypted: consumed.pending_email_encrypted,
    };
  }
}
