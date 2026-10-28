import { z } from 'zod';
import { paginatedSchema } from '@shared/domain/dtos/requests/pagination.dto.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';

/** Itens por página nas iscas (RF21: baixo volume). */
export const DECOY_MAX_PAGE_SIZE = 10;

/**
 * Página pedida a uma isca. `page_size` acima de 10 é reduzido a 10, sem erro: quem raspa
 * recebe pouco, e não um aviso de que pediu demais.
 */
export const DecoyCompanyListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  page_size: z.coerce
    .number()
    .int()
    .min(1)
    .default(DECOY_MAX_PAGE_SIZE)
    .transform((size) => Math.min(size, DECOY_MAX_PAGE_SIZE)),
});

export type DecoyCompanyListQuery = z.infer<typeof DecoyCompanyListQuerySchema>;

/** CNPJ do detalhe: validado como na API real (422 para o inválido). */
export const DecoyCompanyParamsSchema = z.object({
  cnpj: z.string().transform((text, context) => {
    const cnpj = parseCnpj(text);

    if (cnpj === null) {
      context.addIssue({ code: 'custom', message: 'CNPJ inválido.' });
      return z.NEVER;
    }

    return cnpj;
  }),
});

export type DecoyCompanyParams = z.infer<typeof DecoyCompanyParamsSchema>;

/**
 * Empresa sintética, no formato parecido com o da API real. Nenhum campo vem do banco:
 * tudo é gerado na hora (#88).
 */
export const DecoyCompanySchema = z.object({
  cnpj: z.string(),
  legal_name: z.string(),
  trade_name: z.string().nullable(),
  registration_status: z.string(),
  company_size: z.string(),
  address: z.object({
    city: z.string(),
    uf: z.string(),
    zipcode: z.string(),
  }),
  main_cnae: z.object({ code: z.string(), description: z.string() }),
  ods_scores: z.array(
    z.object({
      ods_number: z.number().int(),
      score_value: z.number(),
      confidence_value: z.number(),
    }),
  ),
});

export type DecoyCompany = z.infer<typeof DecoyCompanySchema>;

export const DecoyCompanyListResponseSchema =
  paginatedSchema(DecoyCompanySchema);

export type DecoyCompanyListResponse = z.infer<
  typeof DecoyCompanyListResponseSchema
>;
