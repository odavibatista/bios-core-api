import { Injectable } from '@nestjs/common';
import { EmailTemplate, UserTokenPurpose } from '@prisma/client';
import { SendTransactionalEmailUseCase } from '@modules/mailing/infra/usecases/send-transactional-email.usecase.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { firstNameOf } from '@shared/domain/value-objects/email-address.js';
import { IssueUserTokenUseCase } from './issue-user-token.usecase.js';

/** Conta que receberá o link de confirmação. */
export interface SendEmailConfirmationRequest {
  userId: string;

  /** Nome de exibição, de que sai a saudação do e-mail. */
  name: string;

  /** E-mail já normalizado, para onde o link é enviado. */
  email: string;
}

/**
 * Emite o token de confirmação e enfileira o e-mail com o link (RF18, RF28).
 *
 * Reúne os dois passos que o cadastro e o reenvio repetem, para que a
 * saudação, o template e a validade informada na mensagem sejam um só.
 * Emitir invalida o link anterior: quem pede reenvio não deixa dois links
 * válidos circulando.
 */
@Injectable()
export class SendEmailConfirmationUseCase extends UseCase<
  SendEmailConfirmationRequest,
  void
> {
  constructor(
    private readonly issueUserTokenUseCase: IssueUserTokenUseCase,
    private readonly sendTransactionalEmailUseCase: SendTransactionalEmailUseCase,
  ) {
    super();
  }

  override async execute({
    userId,
    name,
    email,
  }: SendEmailConfirmationRequest): Promise<void> {
    const { token, validity } = await this.issueUserTokenUseCase.execute({
      userId,
      purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
    });

    await this.sendTransactionalEmailUseCase.execute({
      template: EmailTemplate.EMAIL_CONFIRMATION,
      to: email,
      context: { name: firstNameOf(name), token, validity },
      userId,
    });
  }
}
