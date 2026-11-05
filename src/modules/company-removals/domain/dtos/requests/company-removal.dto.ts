import { z } from 'zod';
import {
  PaginationQuerySchema,
  paginatedSchema,
} from '@shared/domain/dtos/requests/pagination.dto.js';

/** Cadastro retirado, como o administrador o vê. */
export const CompanyRemovalSchema = z
  .object({
    cnpj: z.string().describe('CNPJ retirado, sem pontuação'),
    removed_at: z.iso.datetime().describe('Quando o cadastro foi retirado'),
  })
  .strict()
  .describe('Cadastro retirado a pedido do titular')
  .meta({ id: 'CompanyRemoval' });

export type CompanyRemoval = z.infer<typeof CompanyRemovalSchema>;

export const ListCompanyRemovalsQuerySchema = PaginationQuerySchema;

export type ListCompanyRemovalsQuery = z.infer<
  typeof ListCompanyRemovalsQuerySchema
>;

export const CompanyRemovalListResponseSchema = paginatedSchema(
  CompanyRemovalSchema,
)
  .describe('Cadastros retirados, da retirada mais recente para a mais antiga')
  .meta({ id: 'CompanyRemovalList' });

export type CompanyRemovalListResponse = z.infer<
  typeof CompanyRemovalListResponseSchema
>;

export const AddCompanyRemovalRequestSchema = z
  .object({
    cnpj: z.string().min(1).max(32).describe('CNPJ do cadastro a retirar'),
  })
  .strict()
  .meta({ id: 'AddCompanyRemovalRequest' });

export type AddCompanyRemovalRequest = z.infer<
  typeof AddCompanyRemovalRequestSchema
>;
