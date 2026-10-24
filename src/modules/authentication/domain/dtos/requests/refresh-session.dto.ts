import { z } from 'zod';

/** Corpo da renovação de sessão: o refresh token recebido no login (UC17). */
export const RefreshSessionRequestSchema = z
  .object({
    refresh_token: z
      .string()
      .min(1, 'Informe o refresh token.')
      .max(200, 'O refresh token informado é inválido.')
      .describe('Refresh token vigente, de uso único'),
  })
  .describe('Refresh token a trocar por um novo par de tokens')
  .meta({ id: 'RefreshSessionRequest' });

export type RefreshSessionRequest = z.infer<typeof RefreshSessionRequestSchema>;
