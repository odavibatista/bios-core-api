import { z } from 'zod';

/** Corpo da confirmação de e-mail: o token que veio no link (RF28). */
export const ConfirmEmailRequestSchema = z
  .object({
    token: z
      .string()
      .min(1, 'Informe o token do link.')
      .max(200, 'O token informado é inválido.')
      .describe('Token do link de confirmação enviado por e-mail'),
  })
  .describe('Token para confirmar o e-mail');

export type ConfirmEmailRequest = z.infer<typeof ConfirmEmailRequestSchema>;

/** Corpo do pedido de novo link de confirmação (UC01, fluxo 6.1). */
export const ResendEmailConfirmationRequestSchema = z
  .object({
    email: z
      .email('Informe um e-mail válido.')
      .max(254, 'O e-mail deve ter no máximo 254 caracteres.')
      .describe('E-mail com o qual a conta foi criada'),
  })
  .describe('E-mail que receberá um novo link de confirmação');

export type ResendEmailConfirmationRequest = z.infer<
  typeof ResendEmailConfirmationRequestSchema
>;
