import { DATA_SOURCES } from '@modules/data-sources/infra/db/seeders/data-sources.seeder.js';

/** Tempo máximo de uma chamada comum à fonte (os downloads usam o próprio). */
export const CALL_TIMEOUT_MS = 60_000;

/** `base_url` da fonte no catálogo semeado: o contrato vale para o que vai a produção. */
export function seededBaseUrl(slug: string): string {
  const source = DATA_SOURCES.find((candidate) => candidate.slug === slug);

  if (!source?.base_url) {
    throw new Error(`Fonte ${slug} sem base_url no catálogo semeado.`);
  }

  return source.base_url;
}

/** Junta a base e os segmentos sem duplicar nem perder barras. */
export function joinUrl(base: string, segments: readonly string[]): string {
  return [base.replace(/\/+$/, ''), ...segments].join('/');
}

/** `fetch` com prazo. Nenhum cabeçalho de requisição é registrado nem repassado a erro. */
export function callSource(
  url: string,
  init: RequestInit = {},
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

/**
 * Segredo do teste, lido do ambiente.
 *
 * No CI a ausência é falha (um contrato que não roda é contrato que não vigia);
 * fora dele, a suíte da fonte é pulada com aviso, para quem roda sem credencial.
 */
export function secretOrNull(name: string): string | null {
  const value = process.env[name]?.trim();

  if (value) return value;

  if (process.env.CI) {
    throw new Error(
      `${name} ausente: cadastre-o como secret do repositório no GitHub.`,
    );
  }

  console.warn(`${name} ausente: testes de contrato da fonte ignorados.`);

  return null;
}
