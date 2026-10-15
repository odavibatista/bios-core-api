import { Injectable } from '@nestjs/common';
import { UserTokenPurpose } from '@prisma/client';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { decodePendingEmail } from '../../domain/pending-email.js';
import { EmailAlreadyInUseException } from '../../domain/dtos/errors/email-already-in-use.exception.js';
import { InvalidUserTokenException } from '../../domain/dtos/errors/invalid-user-token.exception.js';
import { UserUpdateOutcome } from '../../domain/dtos/repositories/user.repository.js';
import type { ConfirmEmailRequest } from '../../domain/dtos/requests/email-confirmation.dto.js';
import { ConsumeUserTokenUseCase } from './consume-user-token.usecase.js';
import { UpdateAccountUseCase } from './update-account.usecase.js';

/**
 * Efetiva a troca de e-mail a partir do link enviado ao novo endereço (UC05,
 * fluxo 1.1, RF26, RF28).
 *
 * Abrir o link prova o controle da caixa de entrada do novo e-mail; é isso que
 * autoriza a troca, e por isso o endpoint não exige sessão. O token é gasto
 * antes da gravação. Se o e-mail passou a pertencer a outra conta enquanto o
 * link esperava, a troca não acontece e o titular é avisado.
 *
 * @throws {InvalidUserTokenException} quando o token é desconhecido, expirou,
 * já foi usado, não é de troca de e-mail ou a conta já não existe.
 * @throws {EmailAlreadyInUseException} quando o e-mail passou a ser de outra conta.
 */
@Injectable()
export class ConfirmEmailChangeUseCase extends UseCase<
  ConfirmEmailRequest,
  void
> {
  constructor(
    private readonly consumeUserTokenUseCase: ConsumeUserTokenUseCase,
    private readonly encryptionProvider: EncryptionProvider,
    private readonly updateAccountUseCase: UpdateAccountUseCase,
  ) {
    super();
  }

  override async execute({ token }: ConfirmEmailRequest): Promise<void> {
    const { userId, pendingEmailEncrypted } =
      await this.consumeUserTokenUseCase.execute({
        token,
        purpose: UserTokenPurpose.EMAIL_CHANGE,
      });

    const pending =
      pendingEmailEncrypted === null
        ? null
        : decodePendingEmail(pendingEmailEncrypted);

    // Um token de troca sem e-mail pendente legível não tem o que efetivar.
    if (!pending) throw new InvalidUserTokenException();

    const outcome = await this.updateAccountUseCase.execute({
      userId,
      changes: { email: this.encryptionProvider.decrypt(pending) },
    });

    if (outcome === UserUpdateOutcome.EMAIL_TAKEN) {
      throw new EmailAlreadyInUseException();
    }

    if (outcome === UserUpdateOutcome.NOT_FOUND) {
      throw new InvalidUserTokenException();
    }
  }
}
