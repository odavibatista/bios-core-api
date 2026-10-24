import { z } from 'zod';

/**
 * Política de senha: comprimento, e ao menos uma letra e um dígito.
 *
 * O teto de 128 caracteres existe para limitar o custo de hash de uma entrada
 * absurda, não para restringir quem usa frases longas: o pré-hash do
 * `PasswordProvider` aceita qualquer comprimento sem perder os caracteres
 * finais.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const PasswordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `A senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  )
  .max(
    PASSWORD_MAX_LENGTH,
    `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`,
  )
  .regex(/\p{L}/u, 'A senha deve conter ao menos uma letra.')
  .regex(/\d/, 'A senha deve conter ao menos um número.')
  .describe('Senha de acesso (8 a 128 caracteres, com letra e número)');

/** Corpo do cadastro de conta (UC01). */
export const RegisterUserRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'O nome deve ter ao menos 2 caracteres.')
      .max(100, 'O nome deve ter no máximo 100 caracteres.')
      .describe('Nome de exibição'),
    email: z
      .email('Informe um e-mail válido.')
      .max(254, 'O e-mail deve ter no máximo 254 caracteres.')
      .describe('E-mail de acesso, que será confirmado por link'),
    password: PasswordSchema,
  })
  .describe('Dados para criar uma conta')
  .meta({ id: 'RegisterUserRequest' });

export type RegisterUserRequest = z.infer<typeof RegisterUserRequestSchema>;
