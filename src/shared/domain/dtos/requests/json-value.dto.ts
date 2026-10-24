import { z } from 'zod';

/** Qualquer valor JSON (texto, número, booleano, nulo, lista ou objeto). */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Valor JSON livre, com nome próprio no OpenAPI.
 *
 * É `z.json()` escrito à mão: o Zod dá a um schema recursivo sem nome o nome automático
 * `__schema0`, que aparecia como único componente do documento. Com o `id` o tipo vira
 * `JsonValue`, que um gerador de cliente traduz para o tipo recursivo correspondente.
 */
export const JsonValueSchema: z.ZodType<JsonValue> = z
  .lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(JsonValueSchema),
      z.record(z.string(), JsonValueSchema),
    ]),
  )
  .describe('Valor JSON livre')
  .meta({ id: 'JsonValue' });
