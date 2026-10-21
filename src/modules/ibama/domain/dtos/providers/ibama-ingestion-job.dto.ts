import { z } from 'zod';

/** Nome do job do lote diário do IBAMA na fila `environmental-evidences`. */
export const INGEST_IBAMA_DUMPS_JOB = 'ingest-ibama-dumps';

/**
 * O que o consumidor confere do payload do job.
 *
 * O lote diário não leva parâmetro algum: o agendador publica o job com a carga
 * vazia, e é o catálogo (`data_sources`) que diz de onde baixar. O que não for
 * um objeto é rejeitado: o que vem da fila é entrada externa, ainda que o
 * produtor seja o próprio core.
 */
export const IbamaIngestionJobPayloadSchema = z.object({});

/**
 * Como a execução do lote terminou.
 *
 *  - `SUCCEEDED`: o dump mudou, foi normalizado e gravado;
 *  - `SKIPPED_UNCHANGED`: o dump é idêntico ao da última execução bem-sucedida;
 *    nada foi reprocessado, e a validade das evidências foi renovada.
 */
export type IbamaIngestionOutcome = 'SUCCEEDED' | 'SKIPPED_UNCHANGED';

/** O que o consumidor devolve ao concluir o job (fica no registro do job no BullMQ). */
export interface IbamaIngestionJobResult {
  outcome: IbamaIngestionOutcome;

  /** Execução registrada em `ingestion_runs`. */
  ingestionRunId: string;

  /** Checksum combinado dos dois dumps (ver `combineDumpChecksums`). */
  dumpChecksum: string;

  /** Linhas lidas dos dois dumps, as descartadas incluídas. */
  recordsRead: number;

  /** Evidências gravadas (criadas ou atualizadas). */
  recordsUpserted: number;

  /** Linhas descartadas (pessoa física, sem documento, malformadas…) mais os registros anulados. */
  recordsDiscarded: number;

  /** Evidências removidas por terem deixado de constar no dump. */
  removed: number;

  /** Evidências com a validade renovada por o dump não ter mudado. */
  renewed: number;
}
