import { EmailTemplate } from '@prisma/client';
import type { EmailTemplateContexts } from '@modules/mailing/domain/dtos/providers/email-template.dto.js';
import { faker } from '../../support/faker.js';

/** Token de uso único, no formato dos tokens de e-mail (base64url). */
export function buildEmailToken(): string {
  return faker.string.alphanumeric({ length: 43 });
}

/** Validade do link, como aparece na mensagem. */
export function buildValidity(): string {
  return `${faker.number.int({ min: 1, max: 48 })} horas`;
}

/** Contexto de um template com link de ação. */
export function buildTokenContext(): EmailTemplateContexts['EMAIL_CONFIRMATION'] {
  return {
    name: faker.person.firstName(),
    token: buildEmailToken(),
    validity: buildValidity(),
  };
}

/** Contexto do alerta de acesso suspeito. */
export function buildAlertContext(): EmailTemplateContexts['SUSPICIOUS_LOGIN_ALERT'] {
  return {
    name: faker.person.firstName(),
    ipAddress: faker.internet.ipv4(),
    occurredAt: faker.date.recent(),
  };
}

/** Templates que levam link de ação por token. */
export const TOKEN_TEMPLATES = [
  EmailTemplate.EMAIL_CONFIRMATION,
  EmailTemplate.EMAIL_CHANGE_CONFIRMATION,
  EmailTemplate.PASSWORD_RESET,
] as const;
