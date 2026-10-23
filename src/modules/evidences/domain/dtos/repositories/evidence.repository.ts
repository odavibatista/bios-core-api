import type {
  EvidenceCategory,
  EvidenceSignal,
  EvidenceState,
  Prisma,
} from '@prisma/client';

/** Evidência pronta para gravar: categoria, ODS, sinal e datas já resolvidos. */
export interface EvidenceToSave {
  /** Chave determinística (`evidence-key.ts`). */
  key: string;

  cnpj: string;
  dataSourceId: string;
  odsId: string;
  category: EvidenceCategory;
  state: EvidenceState;
  signal: EvidenceSignal;
  summary: string | null;
  sourceReference: string | null;
  sourceUrl: string | null;
  details: Prisma.InputJsonValue | null;
  publishedAt: Date | null;
  collectedAt: Date;
  validUntil: Date;
  rawEvidenceId: string | null;
}

/** Evidência como está guardada, com a fonte e o ODS em formato legível. */
export interface StoredEvidence {
  id: string;
  key: string;
  cnpj: string;

  /** Identificador da fonte (`data_sources.slug`). */
  sourceSlug: string;

  /** Nome público da fonte no catálogo, para auditoria. */
  sourceName: string;

  category: EvidenceCategory;

  /** Número do ODS (`ods.ods_number`). */
  odsNumber: number;

  /** Estado da coleta, como gravado: nunca `OUTDATED` (derivado na leitura). */
  state: EvidenceState;

  signal: EvidenceSignal;
  summary: string | null;
  sourceReference: string | null;
  sourceUrl: string | null;
  details: Prisma.JsonValue | null;
  publishedAt: Date | null;
  collectedAt: Date;
  validUntil: Date;
  rawEvidenceId: string | null;
}

/**
 * Contrato das evidências normalizadas (RF08).
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class EvidenceRepository {
  /**
   * Grava a evidência pela chave: cria quando não existe e atualiza quando já
   * existe, sem duplicar nem perder a data de criação. Campo que a nova coleta
   * não traz é limpo, em vez de ficar com o valor da coleta anterior.
   */
  abstract save(evidence: EvidenceToSave): Promise<void>;

  /** Publica um retrato inteiro somente se sua coleta não for mais antiga. */
  abstract replaceSnapshot(
    cnpj: string,
    dataSourceId: string,
    collectedAt: Date,
    evidences: readonly EvidenceToSave[],
    ifUnanswered?: boolean,
  ): Promise<{ saved: number; removed: number }>;

  /**
   * Remove as evidências da fonte, de **qualquer empresa**, coletadas antes de
   * `before`: o que uma carga em lote não renovou. Devolve quantas removeu.
   */
  abstract deleteNotCollectedSince(
    dataSourceId: string,
    before: Date,
  ): Promise<number>;

  /**
   * Renova a validade das evidências da fonte, de **qualquer empresa**, que
   * ainda respondem (`CONFIRMED` ou `NOT_FOUND`): a data de coleta passa a
   * `collectedAt` e a validade, a `validUntil`. As `UNKNOWN` ficam como estão:
   * não há dado a renovar, e a janela delas é a da nova tentativa. Devolve
   * quantas renovou.
   */
  abstract renewValidity(
    dataSourceId: string,
    collectedAt: Date,
    validUntil: Date,
  ): Promise<number>;

  /**
   * Indica se há, para a empresa e a fonte, alguma coleta que de fato
   * respondeu (`CONFIRMED` ou `NOT_FOUND`), isto é, algo além de `UNKNOWN`.
   */
  abstract hasAnsweredCollection(
    cnpj: string,
    dataSourceId: string,
  ): Promise<boolean>;

  /** Todas as evidências da empresa, de todas as fontes. */
  abstract findByCnpj(cnpj: string): Promise<StoredEvidence[]>;
}
