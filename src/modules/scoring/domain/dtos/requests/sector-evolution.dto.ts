import { z } from 'zod';
import { cnaeDivisionDescription } from '../../cnae-divisions.js';
import { cnaeDivisionOf } from '../../sector-evolution.js';

/**
 * CNAE do setor, convertido na divisão (2 dígitos) usada nos agregados. A divisão precisa
 * existir na CNAE 2.3: um código bem formado de divisão inexistente (ex.: 04) é recusado.
 */
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

      if (cnaeDivisionDescription(division) === undefined) {
        context.addIssue({
          code: 'custom',
          message: `CNAE inválido: a divisão ${division} não existe na CNAE 2.3.`,
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
    cnae_division_description: z
      .string()
      .describe('Descrição oficial da divisão CNAE (IBGE)'),
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

/** Setor com agregados, como o seletor do front o mostra (UC10, fluxo normal 1). */
export const SectorReferenceSchema = z
  .object({
    cnae_division: z.string().describe('Divisão CNAE (2 dígitos)'),
    description: z
      .string()
      .describe('Descrição oficial da divisão CNAE (IBGE)'),
  })
  .strict()
  .describe('Setor (divisão CNAE) com evolução registrada')
  .meta({ id: 'SectorReference' });

export const SectorListResponseSchema = z
  .object({
    data: z
      .array(SectorReferenceSchema)
      .describe(
        'Setores com ao menos uma janela, em ordem crescente de divisão',
      ),
  })
  .strict()
  .describe('Setores que a evolução setorial pode mostrar')
  .meta({ id: 'SectorListResponse' });

export type SectorReference = z.infer<typeof SectorReferenceSchema>;
export type SectorListResponse = z.infer<typeof SectorListResponseSchema>;
