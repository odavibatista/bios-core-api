/**
 * Falha ao aplicar a política de retenção de uma coleção.
 */
export interface RetentionSyncFailure {
  /** Índice afetado, no formato `<coleção>.<índice>`. */
  index: string;
  /** Motivo da falha. */
  reason: string;
}

/**
 * Resultado da sincronização das políticas de retenção, por índice
 * (`<coleção>.<índice>`).
 */
export interface RetentionSyncReport {
  created: string[];
  updated: string[];
  unchanged: string[];
  failed: RetentionSyncFailure[];
}
