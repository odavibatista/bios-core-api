import { z } from 'zod';
import {
  PaginationQuerySchema,
  paginatedSchema,
} from '@shared/domain/dtos/requests/pagination.dto.js';
import {
  extractNameTerms,
  hasSignificantTerm,
} from '../../company-name-terms.js';

/** Tamanho máximo do texto digitado na busca por nome. */
const MAX_NAME_LENGTH = 100;

/** Tamanho máximo do nome do município. */
const MAX_CITY_LENGTH = 100;

/** Siglas das unidades da federação. */
export const BRAZILIAN_UFS = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;

/** Menor e maior ODS da Agenda 2030. */
const MIN_ODS_NUMBER = 1;
const MAX_ODS_NUMBER = 17;

/**
 * Campo opcional de formulário: texto em branco vale como "não informado". Sem isso, um
 * campo vazio da tela viraria `0` (números) ou um valor inválido (siglas e códigos).
 */
const optionalField = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    schema.optional(),
  );

/**
 * Pesquisa de empresas (UC06, fluxo 1.1; UC08; RF04, RF13).
 *
 * Todo critério é opcional, mas ao menos um precisa vir, para a pesquisa não devolver a
 * base inteira sem intenção. Os critérios se somam (a empresa precisa atender a todos).
 * Índice mínimo e confiança mínima se referem ao ODS selecionado e não existem sem ele
 * (UC08, regra 2).
 */
export const SearchCompaniesQuerySchema = PaginationQuerySchema.extend({
  name: optionalField(z.string().trim().max(MAX_NAME_LENGTH)).describe(
    'Razão social ou nome fantasia, inteiro ou em parte; acentos e caixa são ignorados. Exige ao menos uma palavra com 3 letras ou mais',
  ),
  uf: optionalField(
    z
      .string()
      .trim()
      .transform((uf) => uf.toUpperCase())
      .pipe(z.enum(BRAZILIAN_UFS)),
  ).describe('Sigla da unidade da federação (ex.: SP)'),
  city: optionalField(z.string().trim().max(MAX_CITY_LENGTH)).describe(
    'Município; acentos, caixa e pontuação são ignorados. Sem a UF, casa o município de qualquer estado',
  ),
  cnae: optionalField(
    z
      .string()
      .transform((cnae) => cnae.replace(/[\s.\-/]/g, ''))
      .pipe(z.string().regex(/^\d{2,7}$/, 'Informe de 2 a 7 dígitos do CNAE.')),
  ).describe(
    'Código CNAE de 2 a 7 dígitos (divisão, grupo, classe ou subclasse), pontuação opcional. Casa o CNAE principal ou algum secundário',
  ),
  ods: optionalField(
    z.coerce.number().int().min(MIN_ODS_NUMBER).max(MAX_ODS_NUMBER),
  ).describe(
    'Número do ODS selecionado; devolve o índice e a confiança dele em cada empresa',
  ),
  min_score: optionalField(z.coerce.number().min(-100).max(100)).describe(
    'Índice mínimo no ODS selecionado (de -100 a 100); exige `ods`',
  ),
  min_confidence: optionalField(z.coerce.number().min(0).max(1)).describe(
    'Confiança mínima no ODS selecionado (de 0 a 1); exige `ods`',
  ),
  order: optionalField(
    z
      .string()
      .trim()
      .transform((order) => order.toLowerCase())
      .pipe(z.enum(['asc', 'desc'])),
  ).describe(
    'Ordena pelo índice do ODS selecionado, do menor para o maior (`asc`) ou do maior para o menor (`desc`); exige `ods`. Empresa sem índice calculado vem sempre ao fim, nos dois sentidos',
  ),
}).superRefine((query, context) => {
  const name = query.name ?? '';
  const cityTerms = extractNameTerms(query.city ?? '');

  if (name !== '' && !hasSignificantTerm(extractNameTerms(name))) {
    context.addIssue({
      code: 'custom',
      path: ['name'],
      message: 'Informe ao menos uma palavra com 3 letras ou mais.',
    });
  }

  if (query.city !== undefined && cityTerms.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['city'],
      message: 'Informe o nome do município.',
    });
  }

  for (const field of ['min_score', 'min_confidence', 'order'] as const) {
    if (query[field] !== undefined && query.ods === undefined) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: 'Informe o ODS (`ods`) a que o filtro se refere.',
      });
    }
  }

  const hasCriterion =
    name !== '' ||
    query.uf !== undefined ||
    query.city !== undefined ||
    query.cnae !== undefined ||
    query.ods !== undefined;

  if (!hasCriterion) {
    context.addIssue({
      code: 'custom',
      message: 'Informe ao menos um critério: nome, uf, city, cnae ou ods.',
    });
  }
});

export type SearchCompaniesQuery = z.infer<typeof SearchCompaniesQuerySchema>;

/** Índice e confiança de uma empresa no ODS selecionado na pesquisa. */
export const CompanySearchOdsScoreSchema = z
  .object({
    ods_number: z.number().int().describe('ODS selecionado'),
    score_value: z
      .number()
      .nullable()
      .describe('Índice de aderência; nulo sem índice calculado ou conclusivo'),
    confidence_value: z
      .number()
      .nullable()
      .describe('Confiança (RF11), separada do índice; nula sem cálculo'),
  })
  .describe('Índice e confiança no ODS selecionado');

/** Empresa na lista de resultados: o bastante para reconhecê-la e abrir o perfil. */
export const CompanySearchItemSchema = z
  .object({
    cnpj: z.string().describe('CNPJ, sem pontuação'),
    legal_name: z.string().describe('Razão social'),
    trade_name: z.string().nullable().describe('Nome fantasia'),
    registration_status: z.string().describe('Situação cadastral'),
    city: z.string().describe('Município'),
    uf: z.string().describe('Unidade da federação (sigla)'),
    main_cnae: z
      .object({
        code: z.string().describe('Código CNAE'),
        description: z.string().describe('Descrição textual do CNAE'),
      })
      .describe('CNAE principal'),
    ods_score: CompanySearchOdsScoreSchema.nullable().describe(
      'Índice e confiança no ODS selecionado; nulo quando a pesquisa não seleciona ODS',
    ),
  })
  .describe('Empresa encontrada');

export type CompanySearchItem = z.infer<typeof CompanySearchItemSchema>;

export const SearchCompaniesResponseSchema = paginatedSchema(
  CompanySearchItemSchema,
).describe('Página de empresas encontradas');

export type SearchCompaniesResponse = z.infer<
  typeof SearchCompaniesResponseSchema
>;
