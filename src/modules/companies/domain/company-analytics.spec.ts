import type { CompanyAnalyticsRows } from './dtos/repositories/company-analytics.repository.js';
import { CompanyAnalyticsResponseSchema } from './dtos/requests/company-analytics.dto.js';
import {
  splitBiomes,
  toCompanyAnalytics,
  toDistribution,
} from './company-analytics.js';

const rows = (overrides: Partial<CompanyAnalyticsRows> = {}) =>
  ({
    companies: 10,
    totals: {
      confirmed_evidences: 4,
      fine_notices: 2,
      fine_amount: 1500.5,
      area_hectares: 12,
    },
    status: [
      { key: 'BAIXADA', count: 3 },
      { key: 'ATIVA', count: 7 },
    ],
    size: [{ key: null, count: 10 }],
    legalNature: [
      { key: '2135', label: 'Empresário (Individual)', count: 2 },
      { key: null, label: '', count: 8 },
    ],
    uf: [{ key: 'SP', count: 10 }],
    sector: [{ key: '47', count: 10 }],
    biome: [{ key: 'Amazonia, Cerrado', count: 2 }],
    infractionType: [{ key: 'Flora', count: 2 }],
    sanction: [],
    year: [
      { year: 2024, count: 1 },
      { year: null, count: 1 },
      { year: 2021, count: 2 },
    ],
    ods: [
      {
        odsNumber: 15,
        companies: 10,
        companiesWithIndex: 6,
        averageScore: -40,
        averageConfidence: 0.3,
        scores: [-100, -80, -41, -40, -20, 100],
        confidences: [0, 0.1, 0.2, 0.5, 1, 1],
      },
    ],
    ...overrides,
  }) satisfies CompanyAnalyticsRows;

describe('toDistribution', () => {
  it('ordena da maior para a menor, e não informado tem nome próprio', () => {
    expect(
      toDistribution([
        { key: 'B', count: 1 },
        { key: null, count: 3 },
        { key: 'A', count: 2 },
        { key: 'C', count: 0 },
      ]),
    ).toEqual([
      { key: 'NAO_INFORMADO', label: 'Não informado', count: 3 },
      { key: 'A', label: 'A', count: 2 },
      { key: 'B', label: 'B', count: 1 },
    ]);
  });

  it('agrupa o que passa do limite em "Outros"', () => {
    const buckets = Array.from({ length: 14 }, (_, index) => ({
      key: String(index).padStart(2, '0'),
      count: 100 - index,
    }));

    const items = toDistribution(buckets);

    expect(items).toHaveLength(12);
    expect(items.at(-1)).toEqual({
      key: 'OUTROS',
      label: 'Outros',
      count: 264,
    });
  });
});

describe('splitBiomes', () => {
  it('conta cada bioma da evidência que cita mais de um', () => {
    expect(
      splitBiomes([
        { key: 'Amazonia, Cerrado', count: 2 },
        { key: 'Cerrado', count: 1 },
        { key: null, count: 9 },
      ]),
    ).toEqual([
      { key: 'Amazonia', count: 2 },
      { key: 'Cerrado', count: 3 },
    ]);
  });
});

describe('toCompanyAnalytics', () => {
  it('monta a resposta do contrato, com setor pela descrição da CNAE', () => {
    const analytics = toCompanyAnalytics(rows(), 5);

    expect(CompanyAnalyticsResponseSchema.parse(analytics)).toBeTruthy();
    expect(analytics.registration.sector[0]?.label).toMatch(/VAREJISTA/i);
    expect(analytics.registration.legal_nature).toEqual([
      { key: 'NAO_INFORMADO', label: 'Não informado', count: 8 },
      { key: '2135', label: 'Empresário (Individual)', count: 2 },
    ]);
    expect(analytics.evidence.biome.map(({ key }) => key)).toEqual([
      'Amazonia',
      'Cerrado',
    ]);
  });

  it('ano sem data fica de fora, e os demais vêm em ordem', () => {
    expect(toCompanyAnalytics(rows(), 5).evidence.year).toEqual([
      { year: 2021, count: 2 },
      { year: 2024, count: 1 },
    ]);
  });

  it('as faixas cobrem a escala inteira, e o limite superior entra na última', () => {
    const [ods] = toCompanyAnalytics(rows(), 5).ods;

    expect(ods?.score_ranges).toHaveLength(10);
    expect(ods?.score_ranges[0]).toEqual({ from: -100, to: -80, count: 1 });
    expect(ods?.score_ranges[3]).toEqual({ from: -40, to: -20, count: 1 });
    expect(ods?.score_ranges.at(-1)).toEqual({ from: 80, to: 100, count: 1 });
    expect(ods?.confidence_ranges).toHaveLength(5);
    expect(ods?.confidence_ranges.at(-1)).toEqual({
      from: 0.8,
      to: 1,
      count: 2,
    });
  });

  it('abaixo da amostra mínima, omite médias e faixas e mantém as contagens', () => {
    const [ods] = toCompanyAnalytics(rows(), 7).ods;

    expect(ods).toEqual({
      ods_number: 15,
      companies: 10,
      companies_with_index: 6,
      average_score: null,
      average_confidence: null,
      score_ranges: [],
      confidence_ranges: [],
    });
  });

  it('não cita nenhuma empresa', () => {
    expect(JSON.stringify(toCompanyAnalytics(rows(), 5))).not.toMatch(
      /cnpj|legal_name/i,
    );
  });
});
