import type { Prisma } from '@prisma/client';
import type {
  SearchCompaniesInput,
  SearchOdsCriteria,
} from '../../../domain/dtos/repositories/company-profile.repository.js';
import {
  registrationStatusExpression,
  wholeCityName,
} from './company-search.pipeline.js';

/**
 * Pesquisa a partir dos índices (#328).
 *
 * Quando o índice do ODS decide quem entra (mínimos) ou em que ordem (\`order\`), partir do
 * perfil obriga a ler o índice de **todas** as empresas antes de paginar: o \`$lookup\` roda
 * uma vez por empresa e o custo cresce com a base inteira (2,7 s para 20 000 empresas).
 * \`company_ods_scores\` guarda \`uf\`, \`city\` e \`cnae_codes\` desnormalizados justamente para
 * que o filtro e a ordenação por índice saiam de um índice composto; aqui eles são usados.
 *
 * Só a pesquisa **sem nome** parte daqui: o nome não está nos índices, e com ele a pesquisa
 * segue pelo perfil (\`buildCompanySearchPipeline\`).
 *
 * \`uf\` não nulo é o que separa as empresas **com perfil** das que só têm índice: a ingestão
 * do IBAMA recalcula o índice de empresas que ninguém consultou, que ficam sem \`uf\`
 * (\`replaceForCompany\` grava a localização do perfil, e sem perfil não há). Elas não são da
 * base da pesquisa (UC08, regra 1) e, sem esse corte, entrariam na contagem e na junção.
 */

/**
 * Quais documentos de índice a consulta quer:
 *  - \`scored\`: com nota (\`score_value\` não nulo; com \`minScore\`, ao menos ele);
 *  - \`unscored\`: sem nota (\`score_value\` nulo), que ainda guardam uma confiança;
 *  - \`any\`: os dois, só limitados pelos mínimos.
 */
export type ScoredMode = 'scored' | 'unscored' | 'any';

/** Pesquisa com ODS selecionado. */
export type ScoredSearchInput = SearchCompaniesInput & {
  ods: SearchOdsCriteria;
};

type ScoredInput = ScoredSearchInput;

/** A pesquisa pode sair dos índices? Exige ODS e nenhum critério de nome. */
export function canSearchFromScores(
  input: SearchCompaniesInput,
): input is ScoredInput {
  const { ods, nameTerms } = input;

  return (
    ods !== undefined &&
    nameTerms.length === 0 &&
    (ods.minScore !== undefined ||
      ods.minConfidence !== undefined ||
      ods.order !== undefined)
  );
}

/** O \`$match\` dos índices: ODS, empresas com perfil, critérios desnormalizados e mínimos. */
export function scoredMatch(
  { uf, cityTerms, cnaePrefix, ods }: ScoredInput,
  mode: ScoredMode,
): Record<string, unknown> {
  const match: Record<string, unknown> = {
    ods_number: ods.number,
    uf: uf ?? { $ne: null },
  };

  if (cityTerms !== undefined && cityTerms.length > 0) {
    match.city = { $regex: wholeCityName(cityTerms), $options: 'i' };
  }

  if (cnaePrefix !== undefined) {
    // Só dígitos (validados na entrada); casa o CNAE principal ou algum secundário.
    match.cnae_codes = { $regex: `^${cnaePrefix}` };
  }

  if (mode === 'unscored') match.score_value = null;
  else if (ods.minScore !== undefined) {
    match.score_value = { $gte: ods.minScore };
  } else if (mode === 'scored') match.score_value = { $ne: null };

  if (ods.minConfidence !== undefined) {
    match.confidence_value = { $gte: ods.minConfidence };
  }

  return match;
}

/** Junta o perfil à linha do índice; o índice sem perfil (órfão) sai aqui. */
const JOIN_PROFILE: Record<string, unknown>[] = [
  {
    $lookup: {
      from: 'company_profile',
      localField: 'cnpj',
      foreignField: 'cnpj',
      as: 'profile',
    },
  },
  { $unwind: '$profile' },
];

/** O que a pesquisa devolve de cada empresa, a partir da linha do índice já com o perfil. */
function scoredItemProjection(odsNumber: number): Record<string, unknown> {
  return {
    _id: 0,
    cnpj: 1,
    legal_name: '$profile.legal_name',
    trade_name: { $ifNull: ['$profile.trade_name', null] },
    registration_status: registrationStatusExpression(
      '$profile.registration_status',
    ),
    city: '$profile.address.city',
    uf: '$profile.address.uf',
    main_cnae: {
      code: '$profile.main_cnae.code',
      description: '$profile.main_cnae.description',
    },
    ods_score: {
      ods_number: { $literal: odsNumber },
      score_value: { $ifNull: ['$score_value', null] },
      confidence_value: { $ifNull: ['$confidence_value', null] },
    },
  };
}

/**
 * Com mínimos e sem ordenação pelo ODS: os índices que passam, juntados ao perfil e na ordem
 * padrão (razão social e CNPJ). O custo é o das empresas que passam nos mínimos.
 */
export function buildScoredFilteredPipeline(
  input: ScoredInput,
): Prisma.InputJsonValue[] {
  return [
    { $match: scoredMatch(input, 'any') },
    ...JOIN_PROFILE,
    {
      $facet: {
        items: [
          { $sort: { 'profile.legal_name': 1, cnpj: 1 } },
          { $skip: input.skip },
          { $limit: input.take },
          { $project: scoredItemProjection(input.ods.number) },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ] as Prisma.InputJsonValue[];
}

/**
 * Uma janela das empresas **com nota**, no sentido pedido: nota, maior confiança primeiro e
 * CNPJ. Pagina antes de juntar o perfil, então só a página custa uma junção.
 */
export function buildScoredPagePipeline(
  input: ScoredInput,
  skip: number,
  take: number,
): Prisma.InputJsonValue[] {
  return [
    { $match: scoredMatch(input, 'scored') },
    {
      $sort: {
        score_value: input.ods.order === 'asc' ? 1 : -1,
        confidence_value: -1,
        cnpj: 1,
      },
    },
    { $skip: skip },
    { $limit: take },
    ...JOIN_PROFILE,
    { $project: scoredItemProjection(input.ods.number) },
  ] as Prisma.InputJsonValue[];
}

/** Quantos índices atendem ao critério. */
export function buildScoredCountPipeline(
  input: ScoredInput,
  mode: ScoredMode,
): Prisma.InputJsonValue[] {
  return [
    { $match: scoredMatch(input, mode) },
    { $count: 'count' },
  ] as Prisma.InputJsonValue[];
}

/** Os CNPJs dos índices que atendem ao critério. */
export function buildScoredCnpjsPipeline(
  input: ScoredInput,
  mode: ScoredMode,
): Prisma.InputJsonValue[] {
  return [
    { $match: scoredMatch(input, mode) },
    { $project: { _id: 0, cnpj: 1 } },
  ] as Prisma.InputJsonValue[];
}
