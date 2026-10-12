import {
  CACHE_NAMESPACES,
  type CacheKey,
} from '../domain/dtos/providers/cache-key.dto.js';

/** Prefixo de todas as chaves, para conviver com outros usos do mesmo Redis. */
export const CACHE_KEY_PREFIX = 'bios:cache';

/**
 * Versão do formato dos valores guardados.
 *
 * Entra na chave de propósito: mudar o formato de um valor em cache torna as
 * entradas antigas ilegíveis para o código novo. Incrementar aqui aposenta
 * todas elas de uma vez, sem precisar limpar o Redis no deploy — as antigas
 * simplesmente deixam de ser consultadas e vencem pelo próprio TTL.
 */
export const CACHE_FORMAT_VERSION = 1;

/**
 * Tempo máximo que uma operação de cache pode levar antes de ser abandonada.
 *
 * O cache existe para encurtar a resposta (NFDE02), então ele não pode esticá-la
 * quando o Redis está lento ou fora do ar. O cliente mantém uma fila interna de
 * comandos enquanto tenta reconectar, e sem este orçamento um `GET` esperaria
 * essa reconexão de braços cruzados. Esgotado o prazo, a operação conta como
 * ausência de dado e a consulta segue para a fonte.
 */
export const CACHE_OPERATION_BUDGET_MS = 500;

/** Chave física no Redis: `bios:cache:v1:<namespace>:<identificador>`. */
export function buildCacheKey({ namespace, identifier }: CacheKey): string {
  return [
    CACHE_KEY_PREFIX,
    `v${CACHE_FORMAT_VERSION}`,
    namespace,
    identifier,
  ].join(':');
}

/** Chaves de um identificador em todos os namespaces. */
export function buildCacheKeysOf(identifier: string): string[] {
  return CACHE_NAMESPACES.map((namespace) =>
    buildCacheKey({ namespace, identifier }),
  );
}
