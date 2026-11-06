import type { SearchCompaniesInput } from './company-profile.repository.js';

/** Uma categoria e quantos itens tem. `key` nulo: dado não informado na fonte. */
export interface AnalyticsBucket {
  key: string | null;
  count: number;
}

export interface AnalyticsNatureBucket extends AnalyticsBucket {
  label: string;
}

export interface AnalyticsOdsRow {
  odsNumber: number;
  companies: number;
  companiesWithIndex: number;
  averageScore: number | null;
  averageConfidence: number | null;
  scores: number[];
  confidences: number[];
}

/** O que os agregados do banco devolvem, antes de virar a resposta. */
export interface CompanyAnalyticsRows {
  companies: number;
  totals: {
    confirmed_evidences: number;
    fine_notices: number;
    fine_amount: number;
    area_hectares: number;
  };
  status: AnalyticsBucket[];
  size: AnalyticsBucket[];
  legalNature: AnalyticsNatureBucket[];
  uf: AnalyticsBucket[];
  sector: AnalyticsBucket[];
  biome: AnalyticsBucket[];
  infractionType: AnalyticsBucket[];
  sanction: AnalyticsBucket[];
  year: { year: number | null; count: number }[];
  ods: AnalyticsOdsRow[];
}

/**
 * Agregados do panorama (UC19, RF37), sobre o mesmo conjunto da pesquisa.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class CompanyAnalyticsRepository {
  abstract aggregate(
    input: Omit<SearchCompaniesInput, 'skip' | 'take'>,
  ): Promise<CompanyAnalyticsRows>;
}
