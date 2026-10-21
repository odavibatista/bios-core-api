import { createHash } from 'node:crypto';

/**
 * JSON com as chaves em ordem alfabética, em todos os níveis: o mesmo conteúdo
 * resulta no mesmo texto, qualquer que seja a ordem em que as chaves foram
 * escritas.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) =>
    nested !== null && typeof nested === 'object' && !Array.isArray(nested)
      ? Object.fromEntries(
          Object.entries(nested).sort(([a], [b]) => a.localeCompare(b)),
        )
      : nested,
  );
}

/** SHA-256, em hexadecimal, do JSON canônico do valor. */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
