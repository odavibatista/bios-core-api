import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';

/**
 * Cabeçalhos de resposta que o navegador deixa o front ler numa chamada de outra origem.
 *
 * Fora dos cabeçalhos "simples" (Content-Type e poucos outros), o navegador esconde do
 * JavaScript tudo o que não estiver aqui:
 *  - `Content-Disposition`: o nome do arquivo XLSX da exportação (UC09);
 *  - `Retry-After`: quanto esperar depois de um 429 (NFSE04), também no corpo do erro.
 */
export const CORS_EXPOSED_HEADERS = ['Content-Disposition', 'Retry-After'];

/**
 * Opções de CORS a partir de `CORS_ORIGINS` (já validada): `true` aceita qualquer origem;
 * a lista restringe às informadas.
 */
export function buildCorsOptions(origins: true | string[]): CorsOptions {
  return { origin: origins, exposedHeaders: CORS_EXPOSED_HEADERS };
}
