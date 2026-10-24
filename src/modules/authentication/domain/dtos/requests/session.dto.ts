import { UserRole } from '@prisma/client';
import { z } from 'zod';

/**
 * Sessão aberta ou renovada: o par de tokens e quem é o dono.
 *
 * Resposta comum do login (UC02) e da renovação (UC17), que entregam o mesmo
 * contrato ao front-end.
 */
export const SessionResponseSchema = z
  .object({
    access_token: z
      .string()
      .describe('JWT de vida curta, enviado em `Authorization: Bearer`'),
    refresh_token: z
      .string()
      .describe('Token opaco de uso único para renovar a sessão'),
    token_type: z.literal('Bearer').describe('Esquema do access token'),
    expires_in: z
      .number()
      .int()
      .positive()
      .describe('Vida do access token, em segundos'),
    user: z
      .object({
        id: z.string().describe('Identificador do usuário'),
        name: z.string().describe('Nome de exibição'),
        role: z.enum(UserRole).describe('Papel de acesso'),
      })
      .describe('Dono da sessão'),
  })
  .describe('Sessão com o par de tokens')
  .meta({ id: 'SessionResponse' });

export type SessionResponse = z.infer<typeof SessionResponseSchema>;

/** Sessão como os casos de uso a devolvem, antes de virar resposta HTTP. */
export interface AuthenticatedSession {
  accessToken: string;
  refreshToken: string;

  /** Vida do access token, em segundos. */
  expiresIn: number;

  user: { id: string; name: string; role: UserRole };
}

/** Converte a sessão do caso de uso na resposta HTTP (snake_case). */
export function toSessionResponse(
  session: AuthenticatedSession,
): SessionResponse {
  return {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    token_type: 'Bearer',
    expires_in: session.expiresIn,
    user: session.user,
  };
}
