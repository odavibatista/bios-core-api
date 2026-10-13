import type { EmailTemplate } from '@prisma/client';

/** Mensagem pronta para envio. */
export interface MailMessage {
  /** Destinatário. */
  to: string;

  /** Assunto. */
  subject: string;

  /** Corpo em HTML. */
  html: string;

  /**
   * Corpo em texto simples, enviado junto do HTML.
   *
   * Atende quem lê e-mail sem HTML e melhora a entrega: mensagem só-HTML é
   * sinal de spam para boa parte dos filtros.
   */
  text: string;
}

/**
 * Pedido de disparo de um e-mail transacional.
 *
 * O conteúdo chega pronto: quem dispara é quem sabe o que escrever. O
 * `template` identifica o tipo do e-mail para a auditoria (`email_dispatch_logs`).
 */
export interface MailDispatchRequest extends MailMessage {
  /** Tipo do e-mail, registrado na auditoria. */
  template: EmailTemplate;

  /** Usuário destinatário, quando o e-mail pertence a uma conta existente. */
  userId?: string;
}

/**
 * Carga do job de envio.
 *
 * Carrega o destinatário em claro porque é o que o transporte precisa, e o
 * identificador do registro de auditoria, que o processor atualiza ao concluir.
 * A carga vive apenas no Redis, pelo tempo do job: a coleção de auditoria e os
 * logs guardam somente o hash do destinatário (INL02).
 */
export interface EmailDispatchJob extends MailMessage {
  /** Registro de auditoria correspondente (`email_dispatch_logs`). */
  dispatchLogId: string;
}
