import type { Prisma } from '@prisma/client';

/**
 * Um registro de uma fonte, já normalizado, que vira uma evidência `CONFIRMED`.
 *
 * Só dados de pessoa jurídica: o descarte de pessoa física (CPF) acontece antes,
 * na ingestão da fonte (INL02).
 */
export interface EvidenceFinding {
  /**
   * Identificador do registro no órgão de origem (ex.: número do auto de
   * infração). É o que se exibe ao usuário para auditoria (RF09) e, quando não
   * há `identity`, o que identifica a evidência entre coletas.
   */
  reference: string;

  /**
   * Identificador do registro que a fonte garante único, quando a `reference`
   * exibida não é (o IBAMA repete o número de um auto em registros diferentes).
   * Identifica a evidência entre coletas no lugar da `reference`.
   */
  identity?: string;

  /** Resumo legível exibido ao usuário. */
  summary?: string | null;

  /** Link do registro na fonte original, para auditoria (RF09). */
  url?: string | null;

  /** Atributos normalizados específicos da fonte. */
  details?: Prisma.InputJsonValue | null;

  /** Data de publicação do registro na fonte. */
  publishedAt?: Date | null;

  /** Registro bruto (`evidence_raw`) de onde a evidência foi derivada. */
  rawEvidenceId?: string | null;
}

/**
 * Resultado de consultar uma fonte para um CNPJ:
 *  - `COLLECTED`: a fonte respondeu. Com registros, cada um é uma evidência;
 *    sem nenhum, a fonte foi consultada e não tem nada da empresa (`NOT_FOUND`);
 *  - `UNAVAILABLE`: a fonte não respondeu. Não se sabe nada (`UNKNOWN`).
 */
export type EvidenceCollectionResult =
  | { status: 'COLLECTED'; findings: readonly EvidenceFinding[] }
  | { status: 'UNAVAILABLE' };

export interface RecordEvidenceCollectionInput {
  /** CNPJ canônico da empresa. */
  cnpj: string;

  /** Identificador da fonte no catálogo (ex.: `IBAMA`). */
  sourceSlug: string;

  result: EvidenceCollectionResult;

  /** Quando a coleta aconteceu; o padrão é agora. */
  collectedAt?: Date;
}

export interface RecordEvidenceCollectionOutput {
  /** Evidências gravadas (criadas ou atualizadas). */
  saved: number;

  /** Evidências antigas da mesma empresa e fonte que a coleta substituiu. */
  removed: number;
}
