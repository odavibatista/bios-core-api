import { Injectable } from '@nestjs/common';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { normalizeEmail } from '@shared/domain/value-objects/email-address.js';
import { UserRepository } from '../../domain/dtos/repositories/user.repository.js';
import type { ResendEmailConfirmationRequest } from '../../domain/dtos/requests/email-confirmation.dto.js';
import { SendEmailConfirmationUseCase } from './send-email-confirmation.usecase.js';

/**
 * Envia um novo link de confirmação a quem ainda não confirmou o e-mail
 * (UC01, fluxo 6.1).
 *
 * Só age quando há uma conta inativa com esse e-mail; em qualquer outro caso
 * — e-mail desconhecido, conta já ativa — termina sem erro e sem enviar nada.
 * O chamador responde sempre a mesma mensagem, para que o endpoint não sirva
 * de consulta de contas existentes.
 */
@Injectable()
export class ResendEmailConfirmationUseCase extends UseCase<
  ResendEmailConfirmationRequest,
  void
> {
  constructor(
    private readonly encryptionProvider: EncryptionProvider,
    private readonly userRepository: UserRepository,
    private readonly sendEmailConfirmationUseCase: SendEmailConfirmationUseCase,
  ) {
    super();
  }

  override async execute({
    email,
  }: ResendEmailConfirmationRequest): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    const account = await this.userRepository.findByEmailHash(
      this.encryptionProvider.blindIndex(normalizedEmail),
    );

    if (!account || account.isActive) return;

    await this.sendEmailConfirmationUseCase.execute({
      userId: account.id,
      name: account.name,
      email: normalizedEmail,
    });
  }
}
