import { Injectable } from '@nestjs/common';
import { UserTokenPurpose } from '@prisma/client';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { UserRepository } from '../../domain/dtos/repositories/user.repository.js';
import type { ConfirmEmailRequest } from '../../domain/dtos/requests/email-confirmation.dto.js';
import { ConsumeUserTokenUseCase } from './consume-user-token.usecase.js';

/**
 * Ativa a conta a partir do link de confirmação (UC01 passos 5-6, RF28).
 *
 * O token é gasto antes da ativação: se a ativação falhar, o link já está
 * gasto e o usuário pede outro (fluxo 6.1), mas um link jamais ativa duas
 * vezes. Conta já ativa ou excluída não é erro — o token era legítimo, e o
 * resultado que o usuário queria (conta ativa) já vale.
 *
 * @throws {InvalidUserTokenException} quando o token é desconhecido, expirou,
 * já foi usado ou não é de confirmação de cadastro.
 */
@Injectable()
export class ConfirmEmailUseCase extends UseCase<ConfirmEmailRequest, void> {
  constructor(
    private readonly consumeUserTokenUseCase: ConsumeUserTokenUseCase,
    private readonly userRepository: UserRepository,
  ) {
    super();
  }

  override async execute({ token }: ConfirmEmailRequest): Promise<void> {
    const { userId } = await this.consumeUserTokenUseCase.execute({
      token,
      purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
    });

    await this.userRepository.activate(userId, new Date());
  }
}
