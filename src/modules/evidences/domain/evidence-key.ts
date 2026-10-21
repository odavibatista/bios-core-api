import type { EvidenceState } from '@prisma/client';

/**
 * Chave determinística de uma evidência (`evidence_normalized.evidence_key`).
 *
 * Reprocessar o mesmo dump, ou coletar de novo a mesma empresa, produz a mesma
 * chave e, portanto, atualiza a evidência em vez de duplicá-la (RF08).
 *
 *  - evidência de um registro: `<fonte>:<cnpj>:<referência no órgão>`;
 *  - resultado da consulta, sem registro: `<fonte>:<cnpj>#<estado>`.
 *
 * O CNPJ entra na chave para que a mesma referência em empresas diferentes
 * (um auto de infração com mais de um autuado) nunca sobrescreva a evidência
 * de outra empresa. Os dois formatos não colidem: o separador depois do CNPJ
 * é `:` num e `#` no outro, e nem o CNPJ nem o slug trazem esses caracteres.
 */
export function buildEvidenceKey(
  sourceSlug: string,
  cnpj: string,
  reference: string,
): string {
  return `${sourceSlug}:${cnpj}:${reference.trim()}`;
}

export function buildPlaceholderKey(
  sourceSlug: string,
  cnpj: string,
  state: Extract<EvidenceState, 'NOT_FOUND' | 'UNKNOWN'>,
): string {
  return `${sourceSlug}:${cnpj}#${state}`;
}
