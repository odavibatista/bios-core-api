import { z } from 'zod';
import { cnaeDivisionOf } from '../../sector-evolution.js';

/** CNAE do setor, convertido na divisão (2 dígitos) usada nos agregados. */
export const SectorEvolutionParamsSchema = z.object({
  cnae: z
    .string()
    .describe(
      'CNAE do setor: divisão (2 dígitos), grupo, classe ou subclasse, com ou sem máscara',
    )
    .transform((code, context) => {
      const division = cnaeDivisionOf(code);

      if (division === null) {
        context.addIssue({
          code: 'custom',
          message:
            'CNAE inválido: informe a divisão (2 dígitos), o grupo, a classe ou a subclasse.',
        });
        return z.NEVER;
      }

      return division;
    }),
});

export type SectorEvolutionParams = z.infer<typeof SectorEvolutionParamsSchema>;

export const SectorEvolutionQuerySchema = z.object({
  ods: z.coerce
    .number()
    .int()
    .min(1)
    .max(17)
    .describe('Número do ODS (obrigatório; um dos calculados pelo BIOS)'),
});

export type SectorEvolutionQuery = z.infer<typeof SectorEvolutionQuerySchema>;

/** Agregado do setor numa janela: só médias e contagens, nunca empresa (IA05). */
export const SectorScoreWindowSchema = z
  .object({
    window_start: z.iso.datetime().describe('Início da janela (mês, UTC)'),
    window_end: z.iso.datetime().describe('Fim da janela, exclusivo'),
    average_score: z
      .number()
      .nullable()
      .describe(
        'Índice médio das empresas do setor com índice; nulo quando elas são menos que o mínimo',
      ),
    average_confidence: z
      .number()
      .nullable()
      .describe(
        'Confiança média das empresas do setor; nula quando elas são menos que o mínimo',
      ),
    company_count: z
      .number()
      .int()
      .describe('Empresas do setor com índice calculado no ODS'),
    scored_company_count: z
      .number()
      .int()
      .describe('Empresas do setor com índice não nulo'),
    rules_version: z.string().describe('Versão das regras de pontuação'),
  })
  .describe('Agregado do setor numa janela de tempo')
  .meta({ id: 'SectorScoreWindow' });

export const SectorEvolutionResponseSchema = z
  .object({
    cnae_division: z.string().describe('Divisão CNAE (2 dígitos) agregada'),
    ods_number: z.number().int().describe('Número do ODS'),
    history_status: z
      .enum(['AVAILABLE', 'INSUFFICIENT'])
      .describe(
        'INSUFFICIENT: menos de duas janelas, ainda não há evolução a mostrar',
      ),
    windows: z
      .array(SectorScoreWindowSchema)
      .describe('Janelas da mais antiga à mais recente'),
  })
  .describe('Evolução do índice médio de um ODS num setor (UC10)')
  .meta({ id: 'SectorEvolution' });

export type SectorEvolutionResponse = z.infer<
  typeof SectorEvolutionResponseSchema
>;
