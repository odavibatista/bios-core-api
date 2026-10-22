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
>;

/** Contrato da leitura dos ODS e da substituição atômica dos índices de uma empresa. */
export abstract class OdsScoreRepository {
  abstract findActiveOds(): Promise<ActiveOds[]>;
  abstract findByCnpjAndOdsNumber(
    cnpj: string,
    odsNumber: number,
  ): Promise<OdsScoreSnapshot | null>;
  abstract findProfileLocation(
    cnpj: string,
  ): Promise<ScoreProfileLocation | null>;
  abstract replaceForCompany(
    cnpj: string,
    scores: readonly OdsScoreToSave[],
  ): Promise<void>;
}
