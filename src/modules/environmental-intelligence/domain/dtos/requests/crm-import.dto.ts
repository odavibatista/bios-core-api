import { z } from 'zod';
import { EvidenceCategory } from '@prisma/client';
import { RegistrationStatusSchema } from '@modules/companies/domain/dtos/requests/company-profile.dto.js';

/**
 * Máximo de CNPJs em um lote. Com o limite próprio da rota, dá o mesmo volume que a API pública
 * oferece consulta a consulta: 3 lotes de 20 por minuto equivalem às 60 consultas por chave.
 */
export const CRM_IMPORT_MAX_CNPJS = 20;

/** O que aconteceu com cada CNPJ do lote: uma falha não derruba as demais contas. */
export const CrmImportStatus = {
  IMPORTED: 'IMPORTED',
  NOT_FOUND: 'NOT_FOUND',
  INVALID: 'INVALID',
  UNAVAILABLE: 'UNAVAILABLE',
} as const;

export const CrmImportRequestSchema = z
  .object({
    cnpjs: z
      .array(z.string().min(1).max(32))
      .min(1)
      .max(CRM_IMPORT_MAX_CNPJS)
      .describe('CNPJs das contas do CRM; repetidos contam uma vez'),
  })
  .strict()
  .meta({ id: 'CrmImportRequest' });

export type CrmImportRequest = z.infer<typeof CrmImportRequestSchema>;

const CrmAccountOdsSchema = z
  .object({
    ods_number: z.number().int().positive(),
    calculation_status: z.enum(['CALCULATED', 'PENDING']),
    score_value: z.number().min(-100).max(100).nullable(),
    confidence_value: z.number().min(0).max(1).nullable(),
  })
  .strict()
  .meta({ id: 'CrmAccountOds' });

const CrmAccountEvidencesSchema = z
  .object({
    category: z.enum(EvidenceCategory),
    confirmed_count: z.number().int().nonnegative(),
  })
  .strict()
  .meta({ id: 'CrmAccountEvidences' });

/**
 * Conta no formato de importação (UC16, RF31): campos planos, para mapear às colunas do CRM.
 *
 * Leva o mínimo necessário (LGPD, art. 6º, III), com a mesma lista da exportação em XLSX (UC09):
 * sem logradouro, número, complemento e CEP, que no empresário individual costumam ser os da
 * residência. O detalhe das evidências fica em `GET /v1/companies/:cnpj`.
 */
export const CrmAccountSchema = z
  .object({
    external_id: z.string().describe('CNPJ, sem pontuação'),
    legal_name: z
      .string()
      .describe(
        'Razão social; no empresário individual pode conter o nome do titular, com CPF mascarado',
      ),
    trade_name: z.string().nullable(),
    registration_status: RegistrationStatusSchema,
    company_size: z.string().nullable(),
    city: z.string(),
    uf: z.string(),
    main_cnae_code: z.string(),
    main_cnae_description: z.string(),
    ods: z
      .array(CrmAccountOdsSchema)
      .describe('Índice e confiança por ODS, separados e nunca combinados'),
    evidences: z
      .array(CrmAccountEvidencesSchema)
      .describe('Evidências confirmadas por categoria'),
    refreshed_at: z.iso.datetime(),
    scores_pending: z.boolean(),
    retry_after_seconds: z.number().int().positive().nullable(),
  })
  .strict()
  .meta({ id: 'CrmAccount' });

export const CrmImportResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          cnpj: z.string().describe('CNPJ como foi enviado'),
          status: z.enum(CrmImportStatus),
          account: CrmAccountSchema.nullable(),
        })
        .strict()
        .meta({ id: 'CrmImportResult' }),
    ),
  })
  .strict()
  .describe('Contas do lote, na ordem enviada')
  .meta({ id: 'CrmImportResponse' });

export type CrmAccount = z.infer<typeof CrmAccountSchema>;
export type CrmImportResponse = z.infer<typeof CrmImportResponseSchema>;
