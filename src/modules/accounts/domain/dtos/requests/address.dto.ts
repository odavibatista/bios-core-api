import { z } from 'zod';

/** Unidades da federação, em sigla. */
export const BRAZILIAN_STATES = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;

/**
 * Endereço do titular da conta (RF26).
 *
 * É dado pessoal: grava-se serializado e cifrado com AES-256 (NFSE03). O CEP
 * aceita a forma com ou sem hífen e é guardado só com os dígitos.
 */
export const AddressSchema = z
  .object({
    postal_code: z
      .string()
      .regex(/^\d{5}-?\d{3}$/, 'Informe um CEP válido (8 dígitos).')
      .describe('CEP, com ou sem hífen'),
    street: z
      .string()
      .trim()
      .min(2, 'Informe o logradouro.')
      .max(150, 'O logradouro deve ter no máximo 150 caracteres.')
      .describe('Logradouro'),
    number: z
      .string()
      .trim()
      .min(1, 'Informe o número.')
      .max(20, 'O número deve ter no máximo 20 caracteres.')
      .describe('Número (ou "s/n")'),
    complement: z
      .string()
      .trim()
      .max(60, 'O complemento deve ter no máximo 60 caracteres.')
      .optional()
      .describe('Complemento'),
    neighborhood: z
      .string()
      .trim()
      .min(2, 'Informe o bairro.')
      .max(100, 'O bairro deve ter no máximo 100 caracteres.')
      .describe('Bairro'),
    city: z
      .string()
      .trim()
      .min(2, 'Informe a cidade.')
      .max(100, 'A cidade deve ter no máximo 100 caracteres.')
      .describe('Cidade'),
    state: z
      .enum(BRAZILIAN_STATES, 'Informe a sigla de uma unidade da federação.')
      .describe('Unidade da federação (sigla)'),
  })
  .describe('Endereço do titular da conta');

export type Address = z.infer<typeof AddressSchema>;
