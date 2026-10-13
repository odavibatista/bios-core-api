import { Injectable } from '@nestjs/common';
import type { EmailTemplate } from '@prisma/client';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import type { EmailTemplateContexts } from '../../domain/dtos/providers/email-template.dto.js';
import { TemplateRendererProvider } from '../../domain/providers/template-renderer.provider.js';
import { DispatchEmailUseCase } from './dispatch-email.usecase.js';

/** Pedido de envio de um e-mail transacional, pelo template e seu contexto. */
export interface TransactionalEmailRequest<
  T extends EmailTemplate = EmailTemplate,
> {
  template: T;

  /** Destinatário. */
  to: string;

  /** Variáveis do template, verificadas contra ele. */
  context: EmailTemplateContexts[T];

  /** Usuário destinatário, quando o e-mail pertence a uma conta existente. */
  userId?: string;
}

/**
 * Renderiza e enfileira um e-mail transacional (RF18).
 *
 * É este o caso de uso que os fluxos de negócio chamam: cadastro, troca de
 * e-mail, recuperação de senha e alerta de acesso suspeito pedem um template e
 * seus dados, sem montar assunto nem corpo.
 *
 * Renderizar antes de enfileirar é deliberado: o job carrega a mensagem pronta,
 * então uma mudança de template não altera o conteúdo de um e-mail que já estava
 * na fila, e o consumidor não precisa dos templates para enviar.
 *
 * Devolve o identificador do registro de auditoria.
 */
@Injectable()
export class SendTransactionalEmailUseCase extends UseCase<
  TransactionalEmailRequest,
  string
> {
  constructor(
    private readonly templateRendererProvider: TemplateRendererProvider,
    private readonly dispatchEmailUseCase: DispatchEmailUseCase,
  ) {
    super();
  }

  override async execute<T extends EmailTemplate>({
    template,
    to,
    context,
    userId,
  }: TransactionalEmailRequest<T>): Promise<string> {
    const { subject, html, text } = await this.templateRendererProvider.render(
      template,
      context,
    );

    return this.dispatchEmailUseCase.execute({
      template,
      to,
      subject,
      html,
      text,
      userId,
    });
  }
}
