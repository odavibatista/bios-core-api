import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { AddressSchema } from './address.dto.js';

/** Dados da própria conta, como o painel de conta os exibe (UC05). */
export const AccountResponseSchema = z
  .object({
    id: z.string().describe('Identificador do usuário'),
    name: z.string().describe('Nome de exibição'),
    email: z.string().describe('E-mail da conta'),
    address: AddressSchema.nullable().describe(
      'Endereço do titular; nulo quando não informado',
    ),
    role: z.enum(UserRole).describe('Papel de acesso'),
  })
  .describe('Dados da conta do usuário autenticado');

export type AccountResponse = z.infer<typeof AccountResponseSchema>;

/**
 * Corpo da edição dos dados da conta (UC05, RF26).
 *
 * Os campos são opcionais, mas ao menos um precisa vir. `address: null`
 * remove o endereço da conta.
 */
export const UpdateAccountRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'O nome deve ter ao menos 2 caracteres.')
      .max(100, 'O nome deve ter no máximo 100 caracteres.')
      .optional()
      .describe('Novo nome de exibição'),
    address: AddressSchema.nullable()
      .optional()
      .describe('Novo endereço; null remove o endereço'),
  })
  .refine(({ name, address }) => name !== undefined || address !== undefined, {
    message: 'Informe ao menos um campo a alterar (nome ou endereço).',
  })
  .describe('Dados da conta a alterar');

export type UpdateAccountRequest = z.infer<typeof UpdateAccountRequestSchema>;

/**
 * Corpo do pedido de troca de e-mail (UC05, fluxo 1.1).
 *
 * Exige a senha atual: o e-mail é o canal de recuperação da conta, e quem
 * apenas tem uma sessão aberta não deve poder redirecioná-lo.
 */
export const ChangeEmailRequestSchema = z
  .object({
    new_email: z
      .email('Informe um e-mail válido.')
      .max(254, 'O e-mail deve ter no máximo 254 caracteres.')
      .describe('Novo e-mail, que receberá o link de confirmação'),
    current_password: z
      .string()
      .min(1, 'Informe a senha atual.')
      .max(128, 'A senha deve ter no máximo 128 caracteres.')
      .describe('Senha atual da conta'),
  })
  .describe('Novo e-mail e senha atual');

export type ChangeEmailRequest = z.infer<typeof ChangeEmailRequestSchema>;

/** Corpo da exclusão da conta, confirmada com a senha (UC05, fluxo 1.2). */
export const DeleteAccountRequestSchema = z
  .object({
    password: z
      .string()
      .min(1, 'Informe a senha.')
      .max(128, 'A senha deve ter no máximo 128 caracteres.')
      .describe('Senha da conta, para confirmar a exclusão'),
  })
  .describe('Confirmação da exclusão da conta');

export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequestSchema>;
