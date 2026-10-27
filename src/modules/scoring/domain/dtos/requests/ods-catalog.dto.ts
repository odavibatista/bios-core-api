import { z } from 'zod';

/** ODS de referência que o BIOS calcula (RF10), como o seletor do front o mostra. */
export const OdsReferenceSchema = z
  .object({
    ods_number: z.number().int().positive().describe('Número oficial do ODS'),
    title: z.string().min(1).describe('Título oficial do ODS'),
    description: z.string().min(1).describe('Descrição do ODS'),
  })
  .strict()
  .describe('ODS de referência ativo no cálculo de índices')
  .meta({ id: 'OdsReference' });

export const OdsListResponseSchema = z
  .object({
    data: z
      .array(OdsReferenceSchema)
      .describe('ODS ativos, em ordem crescente de número'),
  })
  .strict()
  .describe('ODS que o BIOS calcula e aceita na pesquisa e na exportação')
  .meta({ id: 'OdsListResponse' });

export type OdsReference = z.infer<typeof OdsReferenceSchema>;
export type OdsListResponse = z.infer<typeof OdsListResponseSchema>;
