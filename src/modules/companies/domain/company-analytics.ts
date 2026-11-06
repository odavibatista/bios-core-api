import { cnaeDivisionDescription } from '@modules/scoring/domain/cnae-divisions.js';
import type {
  AnalyticsBucket,
  AnalyticsOdsRow,
  CompanyAnalyticsRows,
} from './dtos/repositories/company-analytics.repository.js';
import type { CompanyAnalytics } from './dtos/requests/company-analytics.dto.js';

/** Categorias com gráfico legível; o resto vai para "Outros". */
const MAX_CATEGORIES = 12;
const OTHERS = { key: 'OUTROS', label: 'Outros' };
const NOT_INFORMED = 'Não informado';

const SCORE_RANGE = { min: -100, max: 100, width: 20 };
const CONFIDENCE_RANGE = { min: 0, max: 1, width: 0.2 };

type Distribution = CompanyAnalytics['registration']['status'];
type LabelOf = (key: string) => string;

/** Maior para a menor, com o CNPJ fora: aqui só há categorias, nunca empresas (IND03). */
export function toDistribution(
  buckets: readonly AnalyticsBucket[],
  labelOf: LabelOf = (key) => key,
): Distribution {
  const sorted = buckets
    .filter(({ count }) => count > 0)
    .map(({ key, count }) => ({
      key: key ?? 'NAO_INFORMADO',
      label: key === null ? NOT_INFORMED : labelOf(key),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  if (sorted.length <= MAX_CATEGORIES) return sorted;

  const others = sorted
    .slice(MAX_CATEGORIES - 1)
    .reduce((total, { count }) => total + count, 0);

  return [...sorted.slice(0, MAX_CATEGORIES - 1), { ...OTHERS, count: others }];
}

/** Junta os biomas da evidência que cita mais de um (`Amazonia, Cerrado`). */
export function splitBiomes(
  buckets: readonly AnalyticsBucket[],
): AnalyticsBucket[] {
  const counts = new Map<string, number>();

  for (const { key, count } of buckets) {
    for (const biome of (key ?? '').split(',')) {
      const name = biome.trim();

      if (name) counts.set(name, (counts.get(name) ?? 0) + count);
    }
  }

  return [...counts].map(([key, count]) => ({ key, count }));
}

function toRanges(
  values: readonly number[],
  { min, max, width }: typeof SCORE_RANGE,
): CompanyAnalytics['ods'][number]['score_ranges'] {
  const size = Math.round((max - min) / width);
  const counts = new Array<number>(size).fill(0);

  for (const value of values) {
    const position = Math.floor((value - min) / width + 1e-9);

    counts[Math.min(position, size - 1)] += 1;
  }

  return counts.map((count, index) => ({
    from: Number((min + index * width).toFixed(1)),
    to: Number((min + (index + 1) * width).toFixed(1)),
    count,
  }));
}

function toOds(row: AnalyticsOdsRow, minimum: number) {
  const hidden = row.companiesWithIndex < minimum;

  return {
    ods_number: row.odsNumber,
    companies: row.companies,
    companies_with_index: row.companiesWithIndex,
    average_score: hidden ? null : row.averageScore,
    average_confidence: hidden ? null : row.averageConfidence,
    score_ranges: hidden ? [] : toRanges(row.scores, SCORE_RANGE),
    confidence_ranges: hidden
      ? []
      : toRanges(row.confidences, CONFIDENCE_RANGE),
  };
}

/**
 * O panorama pronto para a tela. Abaixo da amostra mínima, médias e faixas ficam de fora, para
 * nenhuma revelar o índice de uma empresa (UC10, regra 4); as contagens continuam.
 */
export function toCompanyAnalytics(
  rows: CompanyAnalyticsRows,
  minimum: number,
): CompanyAnalytics {
  return {
    companies: rows.companies,
    minimum_sample: minimum,
    totals: rows.totals,
    registration: {
      status: toDistribution(rows.status),
      size: toDistribution(rows.size),
      legal_nature: toDistribution(
        rows.legalNature.map(({ key, label, count }) => ({
          key,
          count,
          label,
        })),
        (key) =>
          rows.legalNature.find((item) => item.key === key)?.label ?? key,
      ),
      uf: toDistribution(rows.uf),
      sector: toDistribution(
        rows.sector,
        (key) => cnaeDivisionDescription(key) ?? key,
      ),
    },
    evidence: {
      biome: toDistribution(splitBiomes(rows.biome)),
      infraction_type: toDistribution(rows.infractionType),
      sanction: toDistribution(rows.sanction),
      year: [...rows.year]
        .filter(({ year }) => year !== null)
        .map(({ year, count }) => ({ year: year as number, count }))
        .sort((a, b) => a.year - b.year),
    },
    ods: rows.ods
      .map((row) => toOds(row, minimum))
      .sort((a, b) => a.ods_number - b.ods_number),
  };
}
