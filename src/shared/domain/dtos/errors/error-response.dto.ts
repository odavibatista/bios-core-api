import { z } from 'zod';

/**
 * Corpo padronizado de toda resposta de erro da API.
 */
export const ErrorResponseSchema = z
  .object({
    statusCode: z.number().int().describe('Código de status HTTP'),
    code: z
      .string()
      .describe('Código estável do erro (ex.: VALIDATION_FAILED, NOT_FOUND)'),
    message: z.string().describe('Descrição legível do erro'),
    details: z
      .unknown()
      .optional()
      .describe('Detalhes adicionais (ex.: campos inválidos)'),
    timestamp: z.iso.datetime().describe('Momento do erro (ISO 8601)'),
    path: z.string().describe('Caminho da requisição que originou o erro'),
  })
  .describe('Resposta de erro padronizada');

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
