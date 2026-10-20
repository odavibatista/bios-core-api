import type { Prisma } from '@prisma/client';

/** Campos de nome em que a busca procura. */
const NAME_FIELDS = ['legal_name', 'trade_name'] as const;

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

/**
 * Pipeline de agregação da busca por nome (UC06, fluxo 1.1).
 *
 * - **Quem entra:** a empresa em que cada palavra digitada começa alguma
 *   palavra da razão social ou do nome fantasia. A ordem das palavras não
 *   importa, `limpeza urbana` acha `URBANA LIMPEZA`, e uma palavra digitada
 *   pela metade (`petro`) acha `PETROBRAS`. Acentos e caixa não contam.
 * - **Ordem:** primeiro quem *começa* pela frase digitada (as palavras na ordem
 *   digitada, cada uma como início de palavra), depois as demais; empate pela
 *   razão social e pelo CNPJ, que tornam a paginação estável.
 * - **Total:** vem do mesmo `$facet`, numa única ida ao banco.
 *
 * As palavras só têm `A-Z` e `0-9` (`extractNameTerms`), então nenhum texto do
 * usuário vira metacaractere da expressão regular.
 */
export function buildNameSearchPipeline(
  terms: readonly string[],
  skip: number,
  take: number,
): Prisma.InputJsonValue[] {
  const matchesAllTerms = terms.map((term) => ({
    $or: NAME_FIELDS.map((field) => ({
      [field]: { $regex: startsWord(term), $options: 'i' },
    })),
  }));

  const phraseAtStart = `^${terms
    .map(accentTolerant)
    .join(`[${WORD_CHAR}]*[^${WORD_CHAR}]+`)}`;

  return [
    { $match: { $and: matchesAllTerms } },
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
    {
      $facet: {
        items: [
          { $sort: { search_rank: 1, legal_name: 1, cnpj: 1 } },
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
            },
          },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ];
}
