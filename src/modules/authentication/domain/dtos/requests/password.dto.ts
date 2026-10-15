import { PasswordSchema } from '@modules/accounts/domain/dtos/requests/register-user.dto.js';
import { z } from 'zod';

/**
 * Corpo da troca de senha pelo usuário autenticado (UC04).
 *
 * A senha atual não passa pela política de senha (basta existir), como no
 * login; a nova obedece à mesma política do cadastro.
 */
export const ChangePasswordRequestSchema = z
  .object({
    current_password: z
      .string()
      .min(1, 'Informe a senha atual.')
      .max(128, 'A senha deve ter no máximo 128 caracteres.')
      .describe('Senha atual da conta'),
    new_password: PasswordSchema.describe(
      'Nova senha (8 a 128 caracteres, com letra e número)',
    ),
  })
  .describe('Senha atual e nova senha');

export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

/** Corpo do pedido de link de recuperação de senha (UC04, fluxo 1.1). */
export const ForgotPasswordRequestSchema = z
  .object({
    email: z
      .email('Informe um e-mail válido.')
      .max(254, 'O e-mail deve ter no máximo 254 caracteres.')
      .describe('E-mail da conta'),
  })
  .describe('E-mail que receberá o link de recuperação');

export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

/** Corpo da redefinição de senha com o token do link (UC04, fluxo 1.3). */
export const ResetPasswordRequestSchema = z
  .object({
    token: z
      .string()
      .min(1, 'Informe o token do link.')
      .max(200, 'O token informado é inválido.')
      .describe('Token do link de recuperação enviado por e-mail'),
    new_password: PasswordSchema.describe(
      'Nova senha (8 a 128 caracteres, com letra e número)',
    ),
  })
  .describe('Token do link e nova senha');

export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;
