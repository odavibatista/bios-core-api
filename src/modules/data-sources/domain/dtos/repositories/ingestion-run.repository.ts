import type { IngestionRunStatus } from '@prisma/client';

/** Execução de ingestão como está guardada. */
export interface IngestionRunRecord {
  id: string;
  dataSourceId: string;
  status: IngestionRunStatus;

  /** Checksum do dump (combinado, quando a fonte tem mais de um); `null` se ainda não calculado. */
  dumpChecksum: string | null;

  startedAt: Date | null;
  finishedAt: Date | null;
}

/** Abertura (ou reabertura) de uma execução agendada. */
export interface OpenScheduledRunInput {
  dataSourceId: string;

  /** Identificador do job BullMQ: é o que une as tentativas de uma mesma execução. */
  jobId: string;

  /** Início da tentativa em andamento. */
  startedAt: Date;
}

/** Abertura de uma execução restrita a um CNPJ (UC14, fluxo 1.1). */
export interface OpenOnDemandRunInput extends OpenScheduledRunInput {
  cnpj: string;
}

/** Como uma execução terminou. */
export interface IngestionRunOutcome {
  status: Extract<
    IngestionRunStatus,
    'SUCCEEDED' | 'SKIPPED_UNCHANGED' | 'FAILED'
  >;
  dumpChecksum?: string;
  recordsRead: number;
  recordsUpserted: number;
  recordsDiscarded: number;
  errorMessage?: string;
  finishedAt: Date;
}

/**
 * Contrato das execuções de ingestão (`ingestion_runs`, UC14).
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class IngestionRunRepository {
  /**
   * Abre a execução do job agendado, ou **reabre** a que ele já tem.
   *
   * O BullMQ repete o mesmo job (mesmo `jobId`) depois de uma falha, e as
   * tentativas são uma execução só: a linha existente volta a `RUNNING`, com o
   * início da nova tentativa, e sem o erro e o término da anterior. Sem isso,
   * cada tentativa deixaria uma linha, e o histórico deixaria de dizer quantas
   * execuções o dia teve.
   */
  abstract openScheduled(
    input: OpenScheduledRunInput,
  ): Promise<IngestionRunRecord>;

  /** Abre ou reabre apenas a execução avulsa daquele CNPJ. */
  abstract openOnDemand(
    input: OpenOnDemandRunInput,
  ): Promise<IngestionRunRecord>;

  /** A execução do job na fonte, agendada ou avulsa, ou `null`. */
  abstract findByJob(
    dataSourceId: string,
    jobId: string,
  ): Promise<IngestionRunRecord | null>;

  /** Encerra a execução com o resultado. */
  abstract finish(id: string, outcome: IngestionRunOutcome): Promise<void>;

  /**
   * A execução agendada `SUCCEEDED` mais recente da fonte, ou `null`.
   * Uma coleta avulsa não prova que o dump inteiro foi carregado.
   *
   * Só ela serve de referência para "o dump mudou?": uma execução que falhou
   * ou que foi pulada não carregou nada que se possa comparar.
   */
  abstract findLastSucceeded(
    dataSourceId: string,
  ): Promise<IngestionRunRecord | null>;

  /** Último lote completo reconfirmado: inclui o skip que renovou a validade. */
  abstract findLastConfirmedBatch(
    dataSourceId: string,
  ): Promise<IngestionRunRecord | null>;
}
