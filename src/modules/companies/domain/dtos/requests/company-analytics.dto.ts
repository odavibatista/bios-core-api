import { z } from 'zod';

const DistributionItemSchema = z
  .object({
    key: z.string().describe('Código ou valor da categoria'),
    label: z.string().describe('Texto da categoria'),
    count: z.number().int().nonnegative(),
  })
  .strict()
  .meta({ id: 'AnalyticsDistributionItem' });

const DistributionSchema = z
  .array(DistributionItemSchema)
  .describe('Categorias da maior para a menor, com as pequenas em "Outros"');

const RangeSchema = z
  .object({
    from: z.number().describe('Início da faixa, inclusive'),
    to: z.number().describe('Fim da faixa'),
    count: z.number().int().nonnegative(),
  })
  .strict()
  .meta({ id: 'AnalyticsRange' });

const OdsAnalyticsSchema = z
  .object({
    ods_number: z.number().int().positive(),
    companies: z.number().int().nonnegative().describe('Empresas avaliadas'),
    companies_with_index: z.number().int().nonnegative(),
    average_score: z
      .number()
      .nullable()
      .describe('Média do índice; omitida abaixo da amostra mínima'),
    average_confidence: z
      .number()
      .nullable()
      .describe('Média da confiança, sempre separada do índice'),
    score_ranges: z
      .array(RangeSchema)
      .describe('Faixas de índice; vazias abaixo da amostra mínima'),
    confidence_ranges: z
      .array(RangeSchema)
      .describe('Faixas de confiança; vazias abaixo da amostra mínima'),
  })
  .strict()
  .meta({ id: 'OdsAnalytics' });

/**
 * Panorama do conjunto de empresas (UC19, RF37). Só traz contagens e faixas: nenhuma empresa é
 * citada, e nada é ordenado por índice, multa ou número de evidências (IND03).
 */
export const CompanyAnalyticsResponseSchema = z
  .object({
    companies: z.number().int().nonnegative().describe('Empresas no conjunto'),
    minimum_sample: z
      .number()
      .int()
      .positive()
      .describe('Abaixo disso, médias e faixas ficam omitidas'),
    totals: z
      .object({
        confirmed_evidences: z.number().int().nonnegative(),
        fine_notices: z.number().int().nonnegative(),
        fine_amount: z
          .number()
          .nonnegative()
          .describe('Valor lançado nos autos, e não o valor pago'),
        area_hectares: z.number().nonnegative(),
      })
      .strict(),
    registration: z
      .object({
        status: DistributionSchema,
        size: DistributionSchema,
        legal_nature: DistributionSchema,
        uf: DistributionSchema,
        sector: DistributionSchema,
      })
      .strict(),
    evidence: z
      .object({
        biome: DistributionSchema,
        infraction_type: DistributionSchema,
        sanction: DistributionSchema,
        year: z
          .array(
            z
              .object({
                year: z.number().int(),
                count: z.number().int().positive(),
              })
              .strict(),
          )
          .describe('Anos com evidência, em ordem; ano sem evidência não vem'),
      })
      .strict(),
    ods: z.array(OdsAnalyticsSchema),
  })
  .strict()
  .describe('Totais e distribuições do conjunto de empresas')
  .meta({ id: 'CompanyAnalytics' });

export type CompanyAnalytics = z.infer<typeof CompanyAnalyticsResponseSchema>;
