import {
  EvidenceCategory,
  ScoreMovementCause,
  ScoreMovementDirection,
} from '@prisma/client';
import { z } from 'zod';
import {
  PaginationQuerySchema,
  paginatedSchema,
} from '@shared/domain/dtos/requests/pagination.dto.js';

/** Página pedida da lista de movimentações, opcionalmente por categoria. */
export const CompanyMovementsQuerySchema = PaginationQuerySchema.extend({
  category: z
    .enum(EvidenceCategory)
    .optional()
    .describe('Categoria da evidência da movimentação'),
});

export type CompanyMovementsQuery = z.infer<typeof CompanyMovementsQuerySchema>;

/** A última movimentação de um ODS. Nunca leva o índice anterior nem a variação (IND03). */
export const OdsMovementSchema = z
  .object({
    direction: z
      .enum(ScoreMovementDirection)
      .describe(
        'Sentido da mudança: INCREASED (subiu), DECREASED (desceu), AVAILABLE (passou a ter índice) ou UNAVAILABLE (deixou de ter)',
      ),
    cause: z
      .enum(ScoreMovementCause)
      .describe(
        'O que mudou: EVIDENCE_ADDED (entrou evidência), EVIDENCE_REMOVED (saiu evidência) ou WEIGHT_CHANGED (mudou o peso efetivo)',
      ),
    evidence_category: z
      .enum(EvidenceCategory)
      .describe('Categoria da evidência de maior efeito na mudança'),
    moved_at: z.iso.datetime().describe('Data da mudança'),
  })
  .describe('Última movimentação do índice no ODS')
  .meta({ id: 'OdsMovement' });

export const CompanyMovementOdsSchema = z
  .object({
    ods_number: z.number().int().describe('Número do ODS'),
    score_value: z
      .number()
      .nullable()
      .describe('Índice atual; nulo quando o ODS não tem índice (IND02)'),
    confidence_value: z
      .number()
      .nullable()
      .describe('Confiança atual; nula quando o ODS não foi calculado'),
    movement: OdsMovementSchema.nullable().describe(
      'Última movimentação; nula quando o ODS não tem movimentação registrada',
    ),
  })
  .describe('Situação da empresa em um ODS ativo')
  .meta({ id: 'CompanyMovementOds' });

export const CompanyMovementItemSchema = z
  .object({
    cnpj: z.string().describe('CNPJ, sem pontuação'),
    legal_name: z.string().describe('Razão social'),
    trade_name: z.string().nullable().describe('Nome fantasia'),
    city: z.string().describe('Município'),
    uf: z.string().describe('Unidade da federação (sigla)'),
    moved_at: z.iso.datetime().describe('Movimentação mais recente da empresa'),
    ods: z.array(CompanyMovementOdsSchema).describe('Um item por ODS ativo'),
  })
  .describe('Empresa com movimentação registrada')
  .meta({ id: 'CompanyMovementItem' });

export type CompanyMovementItem = z.infer<typeof CompanyMovementItemSchema>;

export const CompanyMovementsResponseSchema = paginatedSchema(
  CompanyMovementItemSchema,
)
  .describe('Página de empresas com movimentação recente')
  .meta({ id: 'CompanyMovementsResponse' });

export type CompanyMovementsResponse = z.infer<
  typeof CompanyMovementsResponseSchema
>;
