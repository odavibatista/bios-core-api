import {
  SourceOutcome,
  type SourceResponse,
} from './dtos/providers/data-source-request.dto.js';

/**
 * Por que uma coleta de fonte externa terminou em `UNKNOWN` (RF08).
 *
 * Conjunto fechado, de propósito: cada motivo diz o que o operador faz a seguir,
 * e um valor novo precisa ser decidido aqui (e não improvisado em texto livre).
 * Nenhum motivo carrega segredo, cabeçalho, corpo de resposta ou dado pessoal.
 */
export const UnknownReason = {
  /** O CNPJ (ou o nome de busca) recebido não serve à consulta. */
  INVALID_INPUT: 'INVALID_INPUT',
  /** A credencial da fonte não está configurada neste ambiente. */
  CREDENTIAL_MISSING: 'CREDENTIAL_MISSING',
  /** A fonte recusou a credencial (HTTP 401 ou 403). */
  CREDENTIAL_REJECTED: 'CREDENTIAL_REJECTED',
  /** A fonte não existe no catálogo `data_sources`. */
  SOURCE_NOT_CONFIGURED: 'SOURCE_NOT_CONFIGURED',
  /** A fonte está desabilitada no catálogo. */
  SOURCE_DISABLED: 'SOURCE_DISABLED',
  /** Limite de requisições atingido (o nosso ou o da fonte, HTTP 429). */
  RATE_LIMITED: 'RATE_LIMITED',
  /** A fonte não respondeu dentro do prazo. */
  TIMEOUT: 'TIMEOUT',
  /** A rota ou a página não existe mais (HTTP 404 onde só 200 é esperado). */
  ENDPOINT_NOT_FOUND: 'ENDPOINT_NOT_FOUND',
  /** A fonte falhou (HTTP 5xx, conexão recusada, resposta ilegível). */
  SOURCE_ERROR: 'SOURCE_ERROR',
  /** A fonte respondeu com um 2xx diferente de 200. */
  UNEXPECTED_STATUS: 'UNEXPECTED_STATUS',
  /** A resposta não tem o formato que o adapter lê: a fonte mudou de contrato. */
  CONTRACT_MISMATCH: 'CONTRACT_MISMATCH',
  /** A paginação não terminou (repetiu página ou passou do teto de páginas). */
  PAGINATION_LIMIT: 'PAGINATION_LIMIT',
  /** A fonte respondeu, mas nenhum registro foi confirmado como da empresa: ausência não está provada. */
  NO_CONFIRMED_MATCH: 'NO_CONFIRMED_MATCH',
  /** Erro que o adapter não classificou: provável defeito do programa. */
  UNEXPECTED_ERROR: 'UNEXPECTED_ERROR',
} as const;

export type UnknownReason = (typeof UnknownReason)[keyof typeof UnknownReason];

/** Motivo de uma resposta que não foi um sucesso. */
export function unknownReasonOf(
  response: Exclude<SourceResponse, { outcome: typeof SourceOutcome.SUCCESS }>,
): UnknownReason {
  switch (response.outcome) {
    case SourceOutcome.DISABLED:
      return UnknownReason.SOURCE_DISABLED;
    case SourceOutcome.TIMEOUT:
      return UnknownReason.TIMEOUT;
    case SourceOutcome.RATE_LIMITED:
      return UnknownReason.RATE_LIMITED;
    case SourceOutcome.NOT_FOUND:
      return UnknownReason.ENDPOINT_NOT_FOUND;
    case SourceOutcome.FAILURE:
      return response.status === 401 || response.status === 403
        ? UnknownReason.CREDENTIAL_REJECTED
        : UnknownReason.SOURCE_ERROR;
  }
}
