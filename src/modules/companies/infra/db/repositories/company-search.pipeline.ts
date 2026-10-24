import type { Prisma } from '@prisma/client';
import type { SearchCompaniesInput } from '../../../domain/dtos/repositories/company-profile.repository.js';

/** Campos de nome em que a busca procura. */
const NAME_FIELDS = ['legal_name', 'trade_name'] as const;

/** Coleção dos índices por ODS, de onde vêm o índice e a confiança do ODS selecionado. */
export const ODS_SCORES_COLLECTION = 'company_ods_scores';

/** Letra ou dígito de qualquer alfabeto: o que separa uma palavra da outra é o resto. */
const WORD_CHAR = String.raw`\p{L}\p{N}`;

/**
 * Variantes acentuadas de cada letra. O banco guarda o nome como a Receita o
 * enviou, e há cadastros com acento; a palavra digitada já chega sem acento
 * (`extractNameTerms`), então cada letra vira a classe que aceita as duas formas.
 */
const ACCENT_VARIANTS: Readonly<Record<string, string>> = {
  A: 'AÁÀÂÃÄ',
  C: 'CÇ',
  E: 'EÉÈÊË',
  I: 'IÍÌÎÏ',
  N: 'NÑ',
  O: 'OÓÒÔÕÖ',
  U: 'UÚÙÛÜ',
};

/** Palavra normalizada em expressão regular que aceita as variantes acentuadas. */
function accentTolerant(term: string): string {
  return [...term]
    .map((char) => {
      const variants = ACCENT_VARIANTS[char];

      return variants ? `[${variants}]` : char;
    })
    .join('');
}

/** Palavra que começa o texto ou vem depois de qualquer separador. */
function startsWord(term: string): string {
  return `(?<![${WORD_CHAR}])${accentTolerant(term)}`;
}

/** Separador entre duas palavras: tudo o que não é letra nem dígito, ao menos um. */
const WORD_SEPARATOR = `[^${WORD_CHAR}]+`;

/**
 * Expressão que casa o nome do município inteiro, palavra a palavra, ignorando acento,
 * caixa e pontuação (`SANTA BARBARA D OESTE` casa `Santa Bárbara d'Oeste`). Não é busca
 * por início de palavra: `SAO PAULO` não casa `SAO PAULO DO POTENGI`.
 */
export function wholeCityName(terms: readonly string[]): string {
  return `^[^${WORD_CHAR}]*${terms
    .map(accentTolerant)
    .join(WORD_SEPARATOR)}[^${WORD_CHAR}]*$`;
}

/** Condições do `$match` cadastral: nome, UF, município e CNAE. Vazio: sem filtro. */
function cadastralConditions({
  nameTerms,
  uf,
  cityTerms,
  cnaePrefix,
}: SearchCompaniesInput): Record<string, unknown>[] {
  const conditions: Record<string, unknown>[] = nameTerms.map((term) => ({
    $or: NAME_FIELDS.map((field) => ({
      [field]: { $regex: startsWord(term), $options: 'i' },
    })),
  }));

  if (uf !== undefined) conditions.push({ 'address.uf': uf });

  if (cityTerms !== undefined && cityTerms.length > 0) {
    conditions.push({
      'address.city': { $regex: wholeCityName(cityTerms), $options: 'i' },
    });
  }

  if (cnaePrefix !== undefined) {
    // Só dígitos (validados na entrada): nenhum texto do usuário vira metacaractere.
    const prefix = { $regex: `^${cnaePrefix}` };

    conditions.push({
      $or: [{ 'main_cnae.code': prefix }, { 'secondary_cnaes.code': prefix }],
    });
  }

  return conditions;
}

/** Junta ao perfil o índice e a confiança do ODS selecionado (campo `ods_score`). */
function odsLookupStages(odsNumber: number): Record<string, unknown>[] {
  return [
    {
      $lookup: {
        from: ODS_SCORES_COLLECTION,
        let: { company_cnpj: '$cnpj' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$cnpj', '$$company_cnpj'] },
                  { $eq: ['$ods_number', odsNumber] },
                ],
              },
            },
          },
          { $project: { _id: 0, score_value: 1, confidence_value: 1 } },
        ],
        as: 'ods_score',
      },
    },
    { $addFields: { ods_score: { $first: '$ods_score' } } },
  ];
}

/**
 * O índice do ODS decide quem entra ou em que ordem? Com mínimo ou ordenação, sim: é preciso
 * conhecê-lo de todas as empresas antes de paginar. Sem eles, só a página precisa dele.
 */
function scoreDecidesPage({ ods }: SearchCompaniesInput): boolean {
  return (
    ods !== undefined &&
    (ods.minScore !== undefined ||
      ods.minConfidence !== undefined ||
      ods.order !== undefined)
  );
}

/** Junta o índice de todas as empresas e aplica os mínimos e a ordenação auxiliar. */
function odsStages(input: SearchCompaniesInput): Record<string, unknown>[] {
  const { ods } = input;

  if (ods === undefined || !scoreDecidesPage(input)) return [];

  const stages = odsLookupStages(ods.number);

  // Empresa sem índice calculado no ODS fica de fora de qualquer mínimo: comparar com
  // ausência ou nulo não é verdadeiro.
  if (ods.minScore !== undefined) {
    stages.push({
      $match: { 'ods_score.score_value': { $gte: ods.minScore } },
    });
  }

  if (ods.minConfidence !== undefined) {
    stages.push({
      $match: { 'ods_score.confidence_value': { $gte: ods.minConfidence } },
    });
  }

  // Empresa sem índice vai ao fim nos dois sentidos: ausência de índice não é o menor nem o
  // maior índice (IND02). Os campos auxiliares fazem o grupo dos sem índice se ordenar só por
  // razão social e CNPJ, e o grupo dos com índice por índice, confiança e CNPJ.
  if (ods.order !== undefined) {
    const missing = {
      $eq: [{ $ifNull: ['$ods_score.score_value', null] }, null],
    };

    stages.push({
      $addFields: {
        score_missing: { $cond: [missing, 1, 0] },
        sort_confidence: {
          $cond: [missing, null, '$ods_score.confidence_value'],
        },
        sort_name: { $cond: [missing, '$legal_name', null] },
      },
    });
  }

  return stages;
}

/**
 * Ordem da lista. Com ordenação pelo ODS: quem tem índice primeiro, no sentido pedido, a
 * maior confiança primeiro entre índices iguais e o CNPJ por último; depois quem não tem
 * índice, por razão social e CNPJ. Sem ordenação: a prioridade da frase digitada, quando há
 * nome, e razão social e CNPJ.
 */
function sortSpec({
  nameTerms,
  ods,
}: SearchCompaniesInput): Record<string, 1 | -1> {
  if (ods?.order !== undefined) {
    return {
      score_missing: 1,
      'ods_score.score_value': ods.order === 'asc' ? 1 : -1,
      sort_confidence: -1,
      sort_name: 1,
      cnpj: 1,
    };
  }

  return nameTerms.length > 0
    ? { search_rank: 1, legal_name: 1, cnpj: 1 }
    : { legal_name: 1, cnpj: 1 };
}

/** Prioridade pela frase digitada, só quando a pesquisa tem nome. */
function nameRankStage(
  nameTerms: readonly string[],
): Record<string, unknown>[] {
  if (nameTerms.length === 0) return [];

  const phraseAtStart = `^${nameTerms
    .map(accentTolerant)
    .join(`[${WORD_CHAR}]*[^${WORD_CHAR}]+`)}`;

  return [
    {
      $addFields: {
        search_rank: {
          $cond: [
            {
              $or: NAME_FIELDS.map((field) => ({
                $regexMatch: {
                  input: { $ifNull: [`$${field}`, ''] },
                  regex: phraseAtStart,
                  options: 'i',
                },
              })),
            },
            0,
            1,
          ],
        },
      },
    },
  ];
}

/** O que a pesquisa devolve de cada empresa, a partir do perfil (campos na raiz). */
function profileItemProjection(
  odsNumber: number | undefined,
): Record<string, unknown> {
  return {
    _id: 0,
    cnpj: 1,
    legal_name: 1,
    trade_name: { $ifNull: ['$trade_name', null] },
    registration_status: 1,
    city: '$address.city',
    uf: '$address.uf',
    main_cnae: {
      code: '$main_cnae.code',
      description: '$main_cnae.description',
    },
    ods_score:
      odsNumber === undefined
        ? { $literal: null }
        : {
            ods_number: { $literal: odsNumber },
            score_value: { $ifNull: ['$ods_score.score_value', null] },
            confidence_value: {
              $ifNull: ['$ods_score.confidence_value', null],
            },
          },
  };
}

/** Opções internas da pesquisa a partir do perfil. */
export interface CompanySearchPipelineOptions {
  /** CNPJs que ficam de fora (já listados em outro segmento da mesma lista). */
  excludeCnpjs?: readonly string[];

  /** Só estes CNPJs entram (os dos índices sem nota que passam no mínimo de confiança). */
  includeCnpjs?: readonly string[];
}

/**
 * Pipeline de agregação da pesquisa de empresas **a partir do perfil** (UC06, fluxo 1.1;
 * UC08; RF04, RF13).
 *
 * - **Quem entra:** a empresa de `company_profile` que atende a **todos** os critérios
 *   informados.
 *   - *Nome:* cada palavra digitada começa alguma palavra da razão social ou do nome
 *     fantasia, em qualquer ordem (`limpeza urbana` acha `URBANA LIMPEZA`; `petro` acha
 *     `PETROBRAS`); acentos e caixa não contam.
 *   - *UF:* sigla exata do endereço.
 *   - *Município:* o nome inteiro, sem distinguir acento, caixa e pontuação.
 *   - *CNAE:* o código (ou seu prefixo: divisão, grupo, classe) casa o CNAE principal ou
 *     algum secundário.
 *   - *ODS:* com um ODS selecionado, o índice e a confiança dele vêm junto de cada
 *     empresa e os mínimos informados filtram. Empresa sem índice calculado no ODS não
 *     passa por mínimo algum.
 * - **Quando o índice é lido:** sem mínimo nem ordenação pelo ODS, o índice só aparece na
 *   resposta e não decide nada; então o `$lookup` roda **depois** da paginação, só para a
 *   página (#328). Com mínimo ou ordenação ele precisa existir antes, para todas as empresas
 *   (as pesquisas sem nome, com isso, saem por `company-scored-search.pipeline.ts`).
 * - **Ordem:** com a ordenação pelo ODS (RF14), quem tem índice primeiro, pelo índice no
 *   sentido pedido, a maior confiança primeiro entre índices iguais e o CNPJ por último;
 *   depois quem não tem índice, por razão social e CNPJ. Sem ela, com nome, primeiro quem
 *   *começa* pela frase digitada (as palavras na ordem digitada, cada uma como início de
 *   palavra), depois as demais; empate, e ordem única sem nome, pela razão social e pelo
 *   CNPJ, que tornam a paginação estável.
 * - **Total:** vem do mesmo `$facet`, numa única ida ao banco.
 *
 * Nome e município só têm `A-Z` e `0-9` (`extractNameTerms`), e o CNAE só dígitos, então
 * nenhum texto do usuário vira metacaractere da expressão regular.
 */
export function buildCompanySearchPipeline(
  input: SearchCompaniesInput,
  { excludeCnpjs, includeCnpjs }: CompanySearchPipelineOptions = {},
): Prisma.InputJsonValue[] {
  const conditions = cadastralConditions(input);
  const { skip, take, nameTerms, ods } = input;
  const lookupAfterPage =
    ods !== undefined && !scoreDecidesPage(input)
      ? odsLookupStages(ods.number)
      : [];

  if (excludeCnpjs !== undefined && excludeCnpjs.length > 0) {
    conditions.push({ cnpj: { $nin: [...excludeCnpjs] } });
  }

  if (includeCnpjs !== undefined) {
    conditions.push({ cnpj: { $in: [...includeCnpjs] } });
  }

  return [
    ...(conditions.length > 0 ? [{ $match: { $and: conditions } }] : []),
    ...odsStages(input),
    ...nameRankStage(nameTerms),
    {
      $facet: {
        items: [
          { $sort: sortSpec(input) },
          { $skip: skip },
          { $limit: take },
          ...lookupAfterPage,
          { $project: profileItemProjection(ods?.number) },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ] as Prisma.InputJsonValue[];
}

/** Quantas empresas do perfil atendem aos critérios cadastrais (sem ler o índice). */
export function buildCompanyCountPipeline(
  input: SearchCompaniesInput,
): Prisma.InputJsonValue[] {
  const conditions = cadastralConditions(input);

  return [
    ...(conditions.length > 0 ? [{ $match: { $and: conditions } }] : []),
    { $count: 'count' },
  ] as Prisma.InputJsonValue[];
}
