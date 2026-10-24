import { z } from 'zod';

/**
 * Resposta dos fluxos de conta que não devem revelar se o e-mail existe: a
 * mensagem é sempre a mesma, exista a conta ou não (UC01, fluxo 2.2).
 */
export const AccountMessageResponseSchema = z
  .object({
    message: z.string().describe('Mensagem para exibir ao usuário'),
  })
  .describe('Mensagem de resultado')
  .meta({ id: 'AccountMessageResponse' });

export type AccountMessageResponse = z.infer<
  typeof AccountMessageResponseSchema
>;
