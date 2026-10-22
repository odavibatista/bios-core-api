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

/** Contrato da leitura dos ODS e da substituição atômica dos índices de uma empresa. */
export abstract class OdsScoreRepository {
  abstract findActiveOds(): Promise<ActiveOds[]>;
  abstract findProfileLocation(
    cnpj: string,
  ): Promise<ScoreProfileLocation | null>;
  abstract replaceForCompany(
    cnpj: string,
    scores: readonly OdsScoreToSave[],
  ): Promise<void>;
}
