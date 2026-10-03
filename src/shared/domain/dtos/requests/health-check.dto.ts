import { z } from 'zod';

/**
 * Resposta do health check quando a API e suas dependências estão disponíveis.
 */
export const HealthCheckResponseSchema = z
  .object({
    status: z.literal('ok').describe('Situação geral da API'),
    uptime_seconds: z
      .number()
      .int()
      .nonnegative()
      .describe('Tempo desde o início do processo, em segundos'),
    checks: z
      .object({
        database: z.literal('up').describe('Situação do banco de dados'),
      })
      .describe('Situação de cada dependência'),
    timestamp: z.iso.datetime().describe('Momento da verificação (ISO 8601)'),
  })
  .describe('Situação da API e de suas dependências');

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;
