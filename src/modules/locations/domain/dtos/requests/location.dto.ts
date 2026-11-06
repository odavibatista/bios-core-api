import { z } from 'zod';
import { BRAZILIAN_UFS } from '@modules/companies/domain/dtos/requests/search-companies.dto.js';
import {
  PaginationQuerySchema,
  paginatedSchema,
} from '@shared/domain/dtos/requests/pagination.dto.js';

/** Tamanho máximo do trecho digitado na busca por município. */
const MAX_CITY_SEARCH_LENGTH = 60;

/** UF do catálogo do IBGE. */
export const IbgeStateSchema = z
  .object({
    ibge_code: z.string().describe('Código IBGE da UF'),
    acronym: z.string().describe('Sigla da UF'),
    name: z.string().describe('Nome oficial da UF'),
  })
  .describe('Unidade da federação')
  .meta({ id: 'IbgeState' });

export type IbgeState = z.infer<typeof IbgeStateSchema>;

/** Lista de UFs. Não é paginada: são sempre 27. */
export const IbgeStateListResponseSchema = z
  .object({ data: z.array(IbgeStateSchema).describe('UFs, por nome') })
  .describe('Unidades da federação')
  .meta({ id: 'IbgeStateList' });

export type IbgeStateListResponse = z.infer<typeof IbgeStateListResponseSchema>;

/** Município do catálogo do IBGE. */
export const IbgeCitySchema = z
  .object({
    ibge_code: z.string().describe('Código IBGE do município, com 7 dígitos'),
    name: z.string().describe('Nome oficial do município'),
    uf: z.string().describe('Sigla da UF'),
  })
  .describe('Município')
  .meta({ id: 'IbgeCity' });

export type IbgeCity = z.infer<typeof IbgeCitySchema>;

export const IbgeCityListResponseSchema = paginatedSchema(IbgeCitySchema)
  .describe('Página de municípios')
  .meta({ id: 'IbgeCityList' });

export type IbgeCityListResponse = z.infer<typeof IbgeCityListResponseSchema>;

/** UF da rota. Aceita minúsculas, como a pesquisa. */
export const StateParamSchema = z.object({
  uf: z
    .string()
    .trim()
    .transform((uf) => uf.toUpperCase())
    .pipe(z.enum(BRAZILIAN_UFS))
    .describe('Sigla da UF'),
});

export type StateParam = z.infer<typeof StateParamSchema>;

/** CEP da rota, com ou sem hífen. Sai só com os dígitos. */
export const PostalCodeParamSchema = z.object({
  cep: z
    .string()
    .trim()
    .regex(/^\d{5}-?\d{3}$/, 'Informe um CEP válido (8 dígitos).')
    .transform((cep) => cep.replace('-', ''))
    .describe('CEP, com ou sem hífen'),
});

export type PostalCodeParam = z.infer<typeof PostalCodeParamSchema>;

/** Endereço de um CEP. Número e complemento nunca vêm: o CEP não os define. */
export const PostalAddressSchema = z
  .object({
    postal_code: z.string().describe('CEP, só com os dígitos'),
    street: z
      .string()
      .nullable()
      .describe('Logradouro; nulo em CEP geral de município'),
    neighborhood: z
      .string()
      .nullable()
      .describe('Bairro; nulo em CEP geral de município'),
    city: z.string().describe('Nome do município'),
    city_ibge_code: z
      .string()
      .nullable()
      .describe('Código IBGE do município; nulo quando não está no catálogo'),
    state: z.string().describe('Sigla da UF'),
  })
  .describe('Endereço de um CEP')
  .meta({ id: 'PostalAddress' });

export type PostalAddress = z.infer<typeof PostalAddressSchema>;

export const ListCitiesQuerySchema = PaginationQuerySchema.extend({
  search: z
    .string()
    .trim()
    .max(MAX_CITY_SEARCH_LENGTH)
    .optional()
    .describe(
      'Trecho do nome do município; acentos, caixa e pontuação são ignorados',
    ),
});

export type ListCitiesQuery = z.infer<typeof ListCitiesQuerySchema>;
