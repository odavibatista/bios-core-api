/** Quantidade máxima de palavras consideradas na busca por nome. */
export const MAX_NAME_TERMS = 8;

/** Tamanho mínimo da palavra que, sozinha, justifica uma busca. */
export const MIN_SIGNIFICANT_TERM_LENGTH = 3;

/**
 * Palavras da busca por nome (UC06, fluxo 1.1), normalizadas.
 *
 * A Receita grava razão social e nome fantasia em maiúsculas e, em geral, sem
 * acento; quem digita não segue essa regra. Por isso o texto perde os acentos
 * (NFD sem marcas combinantes), vai para maiúsculas e é cortado em tudo o que
 * não for letra ou dígito: pontuação como a de `S.A.` ou `CIA.` não separa nem
 * impede a correspondência.
 *
 * O resultado só tem `A-Z` e `0-9`, o que dispensa escapar caracteres quando
 * as palavras viram expressão regular no repositório. As palavras além de
 * `MAX_NAME_TERMS` são descartadas, para a consulta não crescer sem limite.
 */
export function extractNameTerms(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((term) => term.length > 0)
    .slice(0, MAX_NAME_TERMS);
}

/**
 * A busca precisa de ao menos uma palavra com três caracteres ou mais: sem
 * isso, `a b` casaria com quase todas as empresas da base.
 */
export function hasSignificantTerm(terms: readonly string[]): boolean {
  return terms.some((term) => term.length >= MIN_SIGNIFICANT_TERM_LENGTH);
}
