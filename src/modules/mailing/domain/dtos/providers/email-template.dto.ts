import { EmailTemplate } from '@prisma/client';

/** Dados comuns a todo e-mail: quem recebe precisa se reconhecer na mensagem. */
interface RecipientContext {
  /** Primeiro nome do destinatário, como ele se cadastrou. */
  name: string;
}

/** E-mail com link de ação por token de uso único. */
interface TokenContext extends RecipientContext {
  /** Token de uso único, que compõe o link. */
  token: string;

  /** Validade do link, em texto já pronto para leitura (ex.: "2 horas"). */
  validity: string;
}

/** Contexto de cada template, verificado em tempo de compilação. */
export interface EmailTemplateContexts {
  [EmailTemplate.EMAIL_CONFIRMATION]: TokenContext;
  [EmailTemplate.EMAIL_CHANGE_CONFIRMATION]: TokenContext;
  [EmailTemplate.PASSWORD_RESET]: TokenContext;
  [EmailTemplate.SUSPICIOUS_LOGIN_ALERT]: RecipientContext & {
    /** Endereço de origem do acesso suspeito. */
    ipAddress: string;

    /** Momento do evento. */
    occurredAt: Date;
  };
}

/** Mensagem renderizada, nas duas formas que o e-mail carrega. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Assunto de cada template.
 *
 * Em pt-BR e sem dado variável: o assunto fica visível na lista de mensagens do
 * destinatário, inclusive em tela compartilhada.
 */
export const EMAIL_TEMPLATE_SUBJECTS: Readonly<Record<EmailTemplate, string>> =
  {
    [EmailTemplate.EMAIL_CONFIRMATION]: 'Confirme seu e-mail no BIOS',
    [EmailTemplate.EMAIL_CHANGE_CONFIRMATION]:
      'Confirme seu novo e-mail no BIOS',
    [EmailTemplate.PASSWORD_RESET]: 'Redefinição de senha no BIOS',
    [EmailTemplate.SUSPICIOUS_LOGIN_ALERT]:
      'Atividade suspeita na sua conta BIOS',
  };

/**
 * Rota do front-end que recebe o token de cada template.
 *
 * O token vai em segmento de caminho, e não em parâmetro de consulta, para que
 * o link apareça idêntico no HTML: o Handlebars escapa `=`, e um
 * `?token=abc` viraria `?token&#x3D;abc` no código-fonte da mensagem.
 */
export const EMAIL_TEMPLATE_PATHS: Readonly<
  Partial<Record<EmailTemplate, string>>
> = {
  [EmailTemplate.EMAIL_CONFIRMATION]: 'confirmar-email',
  [EmailTemplate.EMAIL_CHANGE_CONFIRMATION]: 'confirmar-novo-email',
  [EmailTemplate.PASSWORD_RESET]: 'redefinir-senha',
};
