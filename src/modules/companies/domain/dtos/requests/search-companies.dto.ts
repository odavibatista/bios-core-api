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

/**
 * Busca de empresas por razão social ou nome fantasia (UC06, fluxo 1.1; RF04).
 *
 * O texto precisa de ao menos uma palavra com três caracteres ou mais, para a
 * busca não varrer a base inteira.
 */
export const SearchCompaniesQuerySchema = PaginationQuerySchema.extend({
  name: z
    .string()
    .trim()
    .max(MAX_NAME_LENGTH)
    .refine((name) => hasSignificantTerm(extractNameTerms(name)), {
      message: 'Informe ao menos uma palavra com 3 letras ou mais.',
    })
    .describe(
      'Razão social ou nome fantasia, inteiro ou em parte; acentos e caixa são ignorados',
    ),
});

export type SearchCompaniesQuery = z.infer<typeof SearchCompaniesQuerySchema>;

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
  })
  .describe('Empresa encontrada');

export type CompanySearchItem = z.infer<typeof CompanySearchItemSchema>;

export const SearchCompaniesResponseSchema = paginatedSchema(
  CompanySearchItemSchema,
).describe('Página de empresas encontradas');

export type SearchCompaniesResponse = z.infer<
  typeof SearchCompaniesResponseSchema
>;
