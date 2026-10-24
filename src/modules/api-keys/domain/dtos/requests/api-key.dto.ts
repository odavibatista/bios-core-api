import { z } from 'zod';

/** Corpo da geração de chave (UC11, fluxo normal, passo 2). */
export const CreateApiKeyRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'O nome deve ter ao menos 2 caracteres.')
      .max(60, 'O nome deve ter no máximo 60 caracteres.')
      .describe('Nome de identificação da chave (ex.: "integração com o CRM")'),
  })
  .describe('Dados para gerar uma chave de API')
  .meta({ id: 'CreateApiKeyRequest' });

export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>;

/**
 * Chave na listagem (UC11, regra de negócio 2): nome, prefixo, data de criação
 * e data do último uso. O identificador serve só para revogar.
 */
export const ApiKeyResponseSchema = z
  .object({
    id: z.string().describe('Identificador, usado para revogar a chave'),
    name: z.string().describe('Nome de identificação'),
    prefix: z.string().describe('Prefixo público da chave'),
    created_at: z.iso.datetime().describe('Quando a chave foi gerada'),
    last_used_at: z.iso
      .datetime()
      .nullable()
      .describe('Último uso; nulo se nunca foi usada'),
  })
  .describe('Chave de API')
  .meta({ id: 'ApiKeyResponse' });

export type ApiKeyResponse = z.infer<typeof ApiKeyResponseSchema>;

/**
 * Chave recém-gerada. É a única resposta que traz o valor completo (`key`):
 * depois dela, só o hash existe (NFSE01), e perder o valor exige gerar outra.
 */
export const CreatedApiKeyResponseSchema = ApiKeyResponseSchema.extend({
  key: z
    .string()
    .describe(
      'Valor completo da chave. Exibido uma única vez: guarde-o agora, pois não poderá ser consultado depois',
    ),
})
  .describe('Chave de API recém-gerada')
  .meta({ id: 'CreatedApiKeyResponse' });

export type CreatedApiKeyResponse = z.infer<typeof CreatedApiKeyResponseSchema>;

/** Lista de chaves ativas. */
export const ApiKeyListResponseSchema = z
  .object({ data: z.array(ApiKeyResponseSchema).describe('Chaves ativas') })
  .describe('Chaves de API ativas do usuário')
  .meta({ id: 'ApiKeyListResponse' });

export type ApiKeyListResponse = z.infer<typeof ApiKeyListResponseSchema>;
