import type { CalculatedOdsScore } from '../requests/calculate-ods-scores.dto.js';

export interface ActiveOds {
  id: string;
  number: number;
}

export interface ScoreProfileLocation {
  uf: string;
  city: string;
  cnaeCodes: string[];
}

export interface OdsScoreToSave extends CalculatedOdsScore {
  location: ScoreProfileLocation | null;
}

export type OdsScoreSnapshot = Pick<
  CalculatedOdsScore,
  | 'cnpj'
  | 'odsNumber'
  | 'scoreValue'
  | 'confidenceValue'
  | 'evidenceCount'
  | 'contributions'
  | 'rulesVersion'
  | 'calculatedAt'
> & {
  /** Nulo em retratos gravados antes da cobertura; passam a ter valor no recálculo (#80). */
  coverageStatus: CalculatedOdsScore['coverageStatus'] | null;
  sourcesWithoutRecords: CalculatedOdsScore['sourcesWithoutRecords'];
};

/** Índice e confiança de uma empresa em um ODS, sem a explicação (listas e exportações). */
export interface OdsScoreSummary {
  cnpj: string;
  odsNumber: number;

  /** Nulo quando não há evidência conclusiva para o ODS. */
  scoreValue: number | null;
  confidenceValue: number;
}

/** Contrato da leitura dos ODS e da substituição atômica dos índices de uma empresa. */
export abstract class OdsScoreRepository {
  abstract findActiveOds(): Promise<ActiveOds[]>;
  abstract findByCnpjAndOdsNumber(
    cnpj: string,
    odsNumber: number,
  ): Promise<OdsScoreSnapshot | null>;
  /** Índice e confiança de todas as empresas dadas, em todos os ODS que têm retrato. */
  abstract findSummariesByCnpjs(
    cnpjs: readonly string[],
  ): Promise<OdsScoreSummary[]>;
  abstract findProfileLocation(
    cnpj: string,
  ): Promise<ScoreProfileLocation | null>;
  /**
   * Substitui, em uma transação, os índices da empresa. **Nunca regride**: se já há índice
   * da empresa calculado depois do instante desta leitura (um recálculo concorrente que
   * leu os dados mais tarde terminou antes), não grava nada e devolve `false`.
   */
  abstract replaceForCompany(
    cnpj: string,
    scores: readonly OdsScoreToSave[],
  ): Promise<boolean>;

  /**
   * Empresas com índice calculado por outra versão das regras, em ordem de CNPJ e a partir
   * do cursor (exclusivo), no máximo `limit` por chamada (varredura paginada, #80).
   */
  abstract findCnpjsWithOtherRulesVersion(
    rulesVersion: string,
    afterCnpj: string | null,
    limit: number,
  ): Promise<string[]>;
}
