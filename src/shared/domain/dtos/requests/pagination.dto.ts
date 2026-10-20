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

/** Situação da paginação devolvida junto da página. */
export const PaginationMetaSchema = z
  .object({
    page: z.number().int().describe('Página devolvida'),
    page_size: z.number().int().describe('Itens por página'),
    total: z.number().int().describe('Total de itens que atendem à consulta'),
    total_pages: z
      .number()
      .int()
      .describe('Total de páginas (0 quando não há itens)'),
  })
  .describe('Paginação');

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

/** Schema de uma página de `itemSchema`, no formato padrão das listagens. */
export function paginatedSchema<TItem extends z.ZodType>(itemSchema: TItem) {
  return z.object({
    data: z.array(itemSchema).describe('Itens da página'),
    pagination: PaginationMetaSchema,
  });
}

/** Monta a paginação a partir do pedido e do total encontrado. */
export function buildPaginationMeta(
  { page, page_size }: PaginationQuery,
  total: number,
): PaginationMeta {
  return {
    page,
    page_size,
    total,
    total_pages: Math.ceil(total / page_size),
  };
}
