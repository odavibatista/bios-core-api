import { z } from 'zod';

/** Recalcula índice e confiança de um CNPJ, para todos os ODS ativos (UC15). */
export const RECALCULATE_SCORES_JOB = 'recalculate-scores';

/**
 * Varredura que reenfileira o recálculo das empresas cujos índices foram calculados com
 * outra versão das regras (`ODS_SCORE_RULES_VERSION`). Agendada; não leva carga.
 */
export const RECALCULATE_STALE_SCORES_JOB = 'recalculate-stale-scores';

/**
 * Agrega os índices por ODS e divisão CNAE na janela do mês corrente (RF30, #89).
 * Agendado; não leva carga.
 */
export const AGGREGATE_SECTOR_SCORES_JOB = 'aggregate-sector-scores';

export const AggregateSectorScoresJobSchema = z.object({}).strict();

/**
 * Varredura que reconstrói a movimentação das empresas com perfil e índice que ainda não a têm
 * (RF33 c). Agendada; não leva carga.
 */
export const RECONCILE_COMPANY_MOVEMENTS_JOB = 'reconcile-company-movements';

export const ReconcileCompanyMovementsJobSchema = z.object({}).strict();

export interface ReconcileCompanyMovementsJobResult {
  /** Quantas empresas ganharam movimentação. */
  created: number;
}

/** Quantas empresas a varredura de movimentações lê por vez. */
export const MOVEMENT_RECONCILE_PAGE_SIZE = 200;

export interface AggregateSectorScoresJobResult {
  /** Início da janela agregada (ISO 8601). */
  windowStart: string;
  /** Quantos agregados (ODS e setor) foram gravados na janela. */
  sectors: number;
}

export const RecalculateScoresJobSchema = z
  .object({ cnpj: z.string() })
  .strict();

export const RecalculateStaleScoresJobSchema = z.object({}).strict();

export interface RecalculateScoresJobResult {
  status: 'CALCULATED';
  /** Quantos ODS tiveram índice gravado nesta execução. */
  odsCount: number;
}

export interface RecalculateStaleScoresJobResult {
  /** Quantas empresas tiveram o recálculo pedido. */
  requested: number;
}

/**
 * Identificador do job de recálculo de uma empresa. É o mesmo para a empresa
 * inteira (sem janela de tempo): a coalescência exata (`EnqueueOptions.coalesce`) funde
 * os pedidos pendentes, e um pedido feito depois de o job terminar gera um job novo.
 */
export function scoresJobId(cnpj: string): string {
  return `scores-${cnpj}`;
}

/** Quantas empresas a varredura por versão de regras lê e reenfileira por vez. */
export const STALE_SCORES_PAGE_SIZE = 200;

/** Quantos pedidos de recálculo um lote publica ao mesmo tempo. */
export const SCORES_REQUEST_CONCURRENCY = 25;
