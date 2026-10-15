import { UserRole } from '@prisma/client';
import { z } from 'zod';

/**
 * Corpo do login (UC02).
 *
 * A senha não passa pela política do cadastro: validar força aqui revelaria a
 * regra a quem tenta adivinhar, e contas antigas poderiam ficar sem acesso se
 * a política mudasse. Basta que haja uma senha, limitada para não gastar hash
 * com entrada absurda.
 */
export const LoginRequestSchema = z
  .object({
    email: z
      .email('Informe um e-mail válido.')
      .max(254, 'O e-mail deve ter no máximo 254 caracteres.')
      .describe('E-mail da conta'),
    password: z
      .string()
      .min(1, 'Informe a senha.')
      .max(128, 'A senha deve ter no máximo 128 caracteres.')
      .describe('Senha da conta'),
  })
  .describe('Credenciais de acesso');

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** Sessão aberta pelo login: o par de tokens e quem entrou. */
export const LoginResponseSchema = z
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
      .describe('Usuário autenticado'),
  })
  .describe('Sessão aberta');

export type LoginResponse = z.infer<typeof LoginResponseSchema>;
