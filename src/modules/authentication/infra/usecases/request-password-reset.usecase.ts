import { Injectable } from '@nestjs/common';
import { EmailTemplate, UserTokenPurpose } from '@prisma/client';
import { UserRepository } from '@modules/accounts/domain/dtos/repositories/user.repository.js';
import { IssueUserTokenUseCase } from '@modules/accounts/infra/usecases/issue-user-token.usecase.js';
import { SendTransactionalEmailUseCase } from '@modules/mailing/infra/usecases/send-transactional-email.usecase.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import {
  firstNameOf,
  normalizeEmail,
} from '@shared/domain/value-objects/email-address.js';
import type { ForgotPasswordRequest } from '../../domain/dtos/requests/password.dto.js';

/**
 * Envia o link de recuperação de senha a quem esqueceu a dela (UC04, fluxo 1.2,
 * RF25).
 *
 * Só age quando há uma conta ativa com esse e-mail; em qualquer outro caso —
 * e-mail desconhecido, conta ainda não confirmada — termina sem erro e sem
 * enviar nada. O chamador responde sempre a mesma mensagem, para que a tela de
 * recuperação não sirva de consulta de contas existentes. Conta não confirmada
 * não recebe link: a saída dela é confirmar o e-mail (UC01), e permitir a
 * recuperação a contornaria.
 *
 * Pedir um novo link invalida o anterior. A validade do link vem de
 * `AUTH_PASSWORD_RESET_TOKEN_LIFETIME`.
 */
@Injectable()
export class RequestPasswordResetUseCase extends UseCase<
  ForgotPasswordRequest,
  void
> {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly encryptionProvider: EncryptionProvider,
    private readonly issueUserTokenUseCase: IssueUserTokenUseCase,
    private readonly sendTransactionalEmailUseCase: SendTransactionalEmailUseCase,
  ) {
    super();
  }

  override async execute({ email }: ForgotPasswordRequest): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    const account = await this.userRepository.findByEmailHash(
      this.encryptionProvider.blindIndex(normalizedEmail),
    );

    if (!account?.isActive) return;

    const { token, validity } = await this.issueUserTokenUseCase.execute({
      userId: account.id,
      purpose: UserTokenPurpose.PASSWORD_RESET,
    });

    await this.sendTransactionalEmailUseCase.execute({
      template: EmailTemplate.PASSWORD_RESET,
      to: normalizedEmail,
      context: { name: firstNameOf(account.name), token, validity },
      userId: account.id,
    });
  }
}
