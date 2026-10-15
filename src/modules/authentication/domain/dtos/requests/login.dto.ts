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
