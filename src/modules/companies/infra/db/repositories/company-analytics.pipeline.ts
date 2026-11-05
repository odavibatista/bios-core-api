import type { Prisma } from '@prisma/client';
import type { SearchCompaniesInput } from '../../../domain/dtos/repositories/company-profile.repository.js';
import { analyticsSetStages } from './company-search.pipeline.js';

type AnalyticsInput = Omit<SearchCompaniesInput, 'skip' | 'take'>;

const countBy = (field: unknown) => [
  { $group: { _id: field, count: { $sum: 1 } } },
  { $project: { _id: 0, key: '$_id', count: 1 } },
];

const numberOr0 = (field: string) => ({
  $cond: [{ $isNumber: field }, field, 0],
});

/** Há critério? Sem nenhum, o panorama é o da base inteira. */
export function hasAnalyticsCriteria({
  nameTerms,
  uf,
  cityTerms,
  cnaePrefix,
  ods,
}: AnalyticsInput): boolean {
  return (
    nameTerms.length > 0 ||
    uf !== undefined ||
    cityTerms !== undefined ||
    cnaePrefix !== undefined ||
    ods !== undefined
  );
}

/** O conjunto da pesquisa, só com os CNPJs. */
export function buildAnalyticsCnpjsPipeline(input: AnalyticsInput): unknown[] {
  return [...analyticsSetStages(input), { $project: { _id: 0, cnpj: 1 } }];
}

/** Situação, porte, natureza jurídica, UF e setor (divisão do CNAE principal). */
export function buildProfileAnalyticsPipeline(
  input: AnalyticsInput,
): Prisma.InputJsonValue[] {
  return [
    ...analyticsSetStages(input),
    {
      $facet: {
        companies: [{ $count: 'count' }],
        status: countBy('$registration_status'),
        size: countBy('$company_size'),
        legalNature: [
          {
            $group: {
              _id: '$legal_nature_code',
              label: { $first: '$legal_nature' },
              count: { $sum: 1 },
            },
          },
          { $project: { _id: 0, key: '$_id', label: 1, count: 1 } },
        ],
        uf: countBy('$address.uf'),
        sector: countBy({ $substrCP: ['$main_cnae.code', 0, 2] }),
      },
    },
  ] as Prisma.InputJsonValue[];
}

/** O ano do fato: a mesma ordem de `evidenceFactDate`, sem nunca usar a data de coleta. */
const FACT_YEAR = {
  $ifNull: [
    {
      $year: {
        $ifNull: [
          '$published_at',
          {
            $dateFromString: {
              dateString: '$details.startDate',
              onError: null,
              onNull: null,
            },
          },
        ],
      },
    },
    '$details.inventoryYear',
    null,
  ],
};

/** Só evidências confirmadas: `NOT_FOUND` e `UNKNOWN` não são fatos sobre a empresa (IND02). */
export function buildEvidenceAnalyticsPipeline(
  cnpjs: readonly string[],
): Prisma.InputJsonValue[] {
  return [
    {
      $match: { state: 'CONFIRMED', cnpj: { $in: [...cnpjs] } },
    },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              confirmed: { $sum: 1 },
              fineNotices: {
                $sum: {
                  $cond: [{ $isNumber: '$details.fine_amount' }, 1, 0],
                },
              },
              fineAmount: { $sum: numberOr0('$details.fine_amount') },
              hectares: { $sum: numberOr0('$details.area_hectares') },
            },
          },
        ],
        biome: [
          { $match: { 'details.biomes': { $type: 'string' } } },
          ...countBy('$details.biomes'),
        ],
        infractionType: [
          { $match: { 'details.infraction_type': { $type: 'string' } } },
          ...countBy('$details.infraction_type'),
        ],
        sanction: [
          { $match: { 'details.sanctionType': { $type: 'string' } } },
          ...countBy('$details.sanctionType'),
        ],
        year: [
          { $group: { _id: FACT_YEAR, count: { $sum: 1 } } },
          { $project: { _id: 0, year: '$_id', count: 1 } },
        ],
      },
    },
  ] as Prisma.InputJsonValue[];
}

/** Índice e confiança por ODS. Nulo não entra nas médias nem nas faixas (IND02). */
export function buildScoreAnalyticsPipeline(
  cnpjs: readonly string[],
): Prisma.InputJsonValue[] {
  return [
    { $match: { cnpj: { $in: [...cnpjs] } } },
    {
      $group: {
        _id: '$ods_number',
        companies: { $sum: 1 },
        averageScore: { $avg: '$score_value' },
        averageConfidence: {
          $avg: {
            $cond: [
              { $isNumber: '$score_value' },
              '$confidence_value',
              '$$REMOVE',
            ],
          },
        },
        scores: {
          $push: {
            $cond: [{ $isNumber: '$score_value' }, '$score_value', '$$REMOVE'],
          },
        },
        confidences: {
          $push: {
            $cond: [
              { $isNumber: '$score_value' },
              '$confidence_value',
              '$$REMOVE',
            ],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        odsNumber: '$_id',
        companies: 1,
        averageScore: 1,
        averageConfidence: 1,
        scores: 1,
        confidences: 1,
      },
    },
  ] as Prisma.InputJsonValue[];
}
