import { Injectable } from '@nestjs/common';
import { SessionRevocationReason, UserTokenPurpose } from '@prisma/client';
import { ConsumeUserTokenUseCase } from '@modules/accounts/infra/usecases/consume-user-token.usecase.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import type { ResetPasswordRequest } from '../../domain/dtos/requests/password.dto.js';
import { ReplacePasswordUseCase } from './replace-password.usecase.js';

/**
 * Define a nova senha a partir do link de recuperação (UC04, fluxo 1.3, RF25).
 *
 * O token é gasto antes de a senha ser gravada: se a gravação falhar, o link já
 * está gasto e o usuário pede outro, mas um link jamais redefine a senha duas
 * vezes. A validade da nova senha é conferida antes, na entrada, de modo que
 * uma senha fraca não queima o link.
 *
 * Ao concluir, todas as sessões da conta são revogadas.
 *
 * @throws {InvalidUserTokenException} quando o token é desconhecido, expirou,
 * já foi usado ou não é de recuperação de senha.
 */
@Injectable()
export class ResetPasswordUseCase extends UseCase<ResetPasswordRequest, void> {
  constructor(
    private readonly consumeUserTokenUseCase: ConsumeUserTokenUseCase,
    private readonly replacePasswordUseCase: ReplacePasswordUseCase,
  ) {
    super();
  }

  override async execute({
    token,
    new_password: newPassword,
  }: ResetPasswordRequest): Promise<void> {
    const { userId } = await this.consumeUserTokenUseCase.execute({
      token,
      purpose: UserTokenPurpose.PASSWORD_RESET,
    });

    await this.replacePasswordUseCase.execute({
      userId,
      newPassword,
      reason: SessionRevocationReason.PASSWORD_RESET,
    });
  }
}
