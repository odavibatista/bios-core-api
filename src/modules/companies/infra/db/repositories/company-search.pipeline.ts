import type { Prisma } from '@prisma/client';
import type { SearchCompaniesInput } from '../../../domain/dtos/repositories/company-profile.repository.js';

/** Campos de nome em que a busca procura. */
const NAME_FIELDS = ['legal_name', 'trade_name'] as const;

/** Coleção dos índices por ODS, de onde vêm o índice e a confiança do ODS selecionado. */
const ODS_SCORES_COLLECTION = 'company_ods_scores';

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
function wholeCityName(terms: readonly string[]): string {
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

/** Junta ao perfil o índice e a confiança do ODS selecionado, e aplica os mínimos. */
function odsStages({ ods }: SearchCompaniesInput): Record<string, unknown>[] {
  if (ods === undefined) return [];

  const stages: Record<string, unknown>[] = [
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
                  { $eq: ['$ods_number', ods.number] },
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

  return stages;
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

/**
 * Pipeline de agregação da pesquisa de empresas (UC06, fluxo 1.1; UC08; RF04, RF13).
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
 * - **Ordem:** com nome, primeiro quem *começa* pela frase digitada (as palavras na ordem
 *   digitada, cada uma como início de palavra), depois as demais; empate, e ordem única
 *   sem nome, pela razão social e pelo CNPJ, que tornam a paginação estável.
 * - **Total:** vem do mesmo `$facet`, numa única ida ao banco.
 *
 * Nome e município só têm `A-Z` e `0-9` (`extractNameTerms`), e o CNAE só dígitos, então
 * nenhum texto do usuário vira metacaractere da expressão regular.
 */
export function buildCompanySearchPipeline(
  input: SearchCompaniesInput,
): Prisma.InputJsonValue[] {
  const conditions = cadastralConditions(input);
  const { skip, take, nameTerms, ods } = input;

  return [
    ...(conditions.length > 0 ? [{ $match: { $and: conditions } }] : []),
    ...odsStages(input),
    ...nameRankStage(nameTerms),
    {
      $facet: {
        items: [
          {
            $sort:
              nameTerms.length > 0
                ? { search_rank: 1, legal_name: 1, cnpj: 1 }
                : { legal_name: 1, cnpj: 1 },
          },
          { $skip: skip },
          { $limit: take },
          {
            $project: {
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
                ods === undefined
                  ? { $literal: null }
                  : {
                      ods_number: { $literal: ods.number },
                      score_value: {
                        $ifNull: ['$ods_score.score_value', null],
                      },
                      confidence_value: {
                        $ifNull: ['$ods_score.confidence_value', null],
                      },
                    },
            },
          },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ] as Prisma.InputJsonValue[];
}
