import { z } from 'zod';

/**
 * Parâmetros de paginação aceitos pelos endpoints de listagem (query string).
 */
export const PaginationQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .min(1)
    .default(1)
    .describe('Página solicitada (a partir de 1)'),
  page_size: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Quantidade de itens por página (máximo de 100)'),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
