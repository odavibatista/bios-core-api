import { Injectable, Logger } from '@nestjs/common';
import { IngestionRunStatus, RequestTrigger } from '@prisma/client';
import { SourceOutcome } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { FindLastSucceededIngestionRunUseCase } from '@modules/data-sources/infra/usecases/ingestion/find-last-succeeded-ingestion-run.usecase.js';
import { FinishIngestionRunUseCase } from '@modules/data-sources/infra/usecases/ingestion/finish-ingestion-run.usecase.js';
import { OpenIngestionRunUseCase } from '@modules/data-sources/infra/usecases/ingestion/open-ingestion-run.usecase.js';
import { OpenEvidenceBatchUseCase } from '@modules/evidences/infra/usecases/open-evidence-batch.usecase.js';
import { RenewSourceEvidencesUseCase } from '@modules/evidences/infra/usecases/renew-source-evidences.usecase.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import {
  type IbamaDumpFailure,
  IbamaDumpUnavailableError,
  IbamaSourceDisabledError,
} from '../../domain/dtos/errors/ibama-ingestion.errors.js';
import type { IbamaIngestionJobResult } from '../../domain/dtos/providers/ibama-ingestion-job.dto.js';
import type { IbamaDump } from '../../domain/dtos/providers/ibama-dump.dto.js';
import { combineDumpChecksums } from '../../domain/ibama-dump-checksum.js';
import { IbamaResource } from '../../domain/ibama-resource.js';
import { RequestScoreRecalculationBatchUseCase } from '@modules/scoring/infra/usecases/request-score-recalculation-batch.usecase.js';
import { IBAMA_SLUG, IbamaDataSource } from '../providers/ibama.data-source.js';
import { NormalizeIbamaRecordsUseCase } from './normalize-ibama-records.usecase.js';

/** Os dois recursos do lote, na ordem em que são baixados e carregados. */
const LOT_RESOURCES = [
  IbamaResource.AUTO_INFRACAO,
  IbamaResource.TERMO_EMBARGO,
] as const;

export interface IngestIbamaDumpsInput {
  /** Identificador do job BullMQ: une as tentativas de uma mesma execução. */
  jobId: string;
}

/**
 * Lote diário do IBAMA (UC14, fluxo normal e fluxo 2.1).
 *
 * Em ordem:
 *  1. abre a execução em `ingestion_runs` (uma por job; a repetição do job a
 *     reabre) e anota o início, que é a data de coleta de tudo o que a carga
 *     grava;
 *  2. baixa **os dois** dumps. Se qualquer um não vier, a execução falha: o
 *     job é repetido com *backoff* e nada é removido;
 *  3. compara o checksum combinado com o da última execução `SUCCEEDED`. Se é o
 *     mesmo, não reprocessa, mas **renova a validade** das evidências: o dado
 *     foi reconfirmado hoje, e sem isso um dump republicado por um fim de
 *     semana as deixaria `OUTDATED`;
 *  4. se mudou, normaliza e grava os dois recursos em fluxo e, **só depois dos
 *     dois**, encerra a carga, que remove as evidências que o dump deixou de
 *     listar. Encerrar com um recurso faltando apagaria evidências válidas dele;
 *  5. registra o resultado e as contagens.
 *
 * Os arquivos temporários dos dumps são apagados sempre, com ou sem falha.
 *
 * Recalcular o índice dos CNPJs afetados (passo 5 do UC14) **não** é feito
 * aqui: é o gatilho de ingestão do recálculo por fila (UC15). O conjunto de
 * afetados não é guardado em memória; é uma consulta: toda evidência gravada
 * por esta execução tem `collected_at` igual ao `started_at` dela.
 *
 * Falhas esperadas são lançadas, para a fila repetir:
 * @throws {IbamaDumpUnavailableError} quando um dump não pôde ser baixado.
 * @throws {IbamaSourceDisabledError} quando a fonte está desabilitada (sem repetição útil).
 * @throws {IbamaDumpFormatError} quando um dump mudou de formato.
 */
@Injectable()
export class IngestIbamaDumpsUseCase extends UseCase<
  IngestIbamaDumpsInput,
  IbamaIngestionJobResult
> {
  private readonly logger = new Logger(IngestIbamaDumpsUseCase.name);

  constructor(
    private readonly ibamaDataSource: IbamaDataSource,
    private readonly openIngestionRun: OpenIngestionRunUseCase,
    private readonly finishIngestionRun: FinishIngestionRunUseCase,
    private readonly findLastSucceeded: FindLastSucceededIngestionRunUseCase,
    private readonly openEvidenceBatch: OpenEvidenceBatchUseCase,
    private readonly normalizeIbamaRecords: NormalizeIbamaRecordsUseCase,
    private readonly renewSourceEvidences: RenewSourceEvidencesUseCase,
    private readonly requestScores: RequestScoreRecalculationBatchUseCase,
  ) {
    super();
  }

  override async execute({
    jobId,
  }: IngestIbamaDumpsInput): Promise<IbamaIngestionJobResult> {
    const startedAt = new Date();
    const run = await this.openIngestionRun.execute({
      sourceSlug: IBAMA_SLUG,
      jobId,
      startedAt,
    });
    this.logger.log(`IBAMA: execução ${run.id} iniciada (job ${jobId}).`);

    const dumps: IbamaDump[] = [];

    try {
      await this.downloadAll(run.id, dumps);

      const dumpChecksum = combineDumpChecksums(dumps);
      const last = await this.findLastSucceeded.execute(IBAMA_SLUG);

      return last?.dumpChecksum === dumpChecksum
        ? await this.skipUnchanged(run.id, startedAt, dumpChecksum)
        : await this.ingest(run.id, startedAt, dumpChecksum, dumps);
    } finally {
      // `allSettled`: apagar um dump não pode impedir de apagar o outro nem
      // mascarar o erro que levou até aqui.
      await Promise.allSettled(dumps.map((dump) => dump.dispose()));
    }
  }

  /**
   * Baixa os dois dumps antes de decidir qualquer coisa. Os que chegam entram em
   * `dumps`, para quem chamou apagar os arquivos mesmo se este método falhar.
   */
  private async downloadAll(
    ingestionRunId: string,
    dumps: IbamaDump[],
  ): Promise<void> {
    const failures: IbamaDumpFailure[] = [];

    for (const resource of LOT_RESOURCES) {
      const result = await this.ibamaDataSource.download(resource, {
        trigger: RequestTrigger.SCHEDULED_JOB,
        ingestionRunId,
      });

      if (result.status === 'FOUND') {
        dumps.push(result.data);
      } else if (
        result.status === 'UNAVAILABLE' &&
        result.reason === SourceOutcome.DISABLED
      ) {
        // A fonte é uma só: com ela desabilitada, o outro dump também não viria.
        throw new IbamaSourceDisabledError();
      } else {
        failures.push({
          resource,
          reason:
            result.status === 'UNAVAILABLE'
              ? (result.message ?? result.reason)
              : 'dump não encontrado',
        });
      }
    }

    if (failures.length > 0) throw new IbamaDumpUnavailableError(failures);
  }

  private async skipUnchanged(
    runId: string,
    startedAt: Date,
    dumpChecksum: string,
  ): Promise<IbamaIngestionJobResult> {
    const renewed = await this.renewSourceEvidences.execute({
      sourceSlug: IBAMA_SLUG,
      collectedAt: startedAt,
    });

    await this.finishIngestionRun.execute({
      runId,
      status: IngestionRunStatus.SKIPPED_UNCHANGED,
      dumpChecksum,
      recordsRead: 0,
      recordsUpserted: 0,
      recordsDiscarded: 0,
    });
    this.logger.log(
      `IBAMA: dumps idênticos aos da última execução; ${renewed} evidências com a validade renovada.`,
    );

    return {
      outcome: 'SKIPPED_UNCHANGED',
      ingestionRunId: runId,
      dumpChecksum,
      recordsRead: 0,
      recordsUpserted: 0,
      recordsDiscarded: 0,
      removed: 0,
      renewed,
    };
  }

  private async ingest(
    runId: string,
    startedAt: Date,
    dumpChecksum: string,
    dumps: readonly IbamaDump[],
  ): Promise<IbamaIngestionJobResult> {
    const batch = await this.openEvidenceBatch.execute({
      sourceSlug: IBAMA_SLUG,
      collectedAt: startedAt,
      ingestionRunId: runId,
    });
    let recordsRead = 0;
    let recordsUpserted = 0;
    let annulled = 0;
    let discarded = 0;

    for (const dump of dumps) {
      const result = await this.normalizeIbamaRecords.execute({
        records: dump.records(),
        batch,
      });

      // As contagens do dump só estão completas depois que `records()` termina.
      recordsRead += dump.stats.rows;
      recordsUpserted += result.written;
      annulled += result.annulled;
      discarded += Object.values(dump.stats.discarded).reduce(
        (total, count) => total + count,
        0,
      );
    }

    // Chegar aqui é ter carregado os dois recursos sem erro: só agora é seguro
    // remover o que o IBAMA deixou de listar.
    const { removed, affectedCnpjs } = await batch.finish();

    // UC14, passo 5: o índice de cada empresa afetada é recalculado (UC15), um job por
    // CNPJ, em lotes. Antes de encerrar a execução: se o processo cair aqui, a execução
    // não fica registrada como bem-sucedida, e a repetição refaz os pedidos.
    const recalculation = await this.requestScores.execute(affectedCnpjs);

    if (recalculation.degraded > 0) {
      this.logger.warn(
        `IBAMA: ${recalculation.degraded} empresa(s) sem recálculo de índice pedido; ` +
          'ficam para a próxima consulta ou recálculo.',
      );
    }
    const recordsDiscarded = discarded + annulled;

    await this.finishIngestionRun.execute({
      runId,
      status: IngestionRunStatus.SUCCEEDED,
      dumpChecksum,
      recordsRead,
      recordsUpserted,
      recordsDiscarded,
    });
    this.logger.log(
      `IBAMA: ${recordsRead} linhas lidas, ${recordsUpserted} evidências gravadas, ` +
        `${discarded} descartadas, ${annulled} anuladas, ${removed} removidas ` +
        `em ${Math.round((Date.now() - startedAt.getTime()) / 1_000)} s.`,
    );

    return {
      outcome: 'SUCCEEDED',
      ingestionRunId: runId,
      dumpChecksum,
      recordsRead,
      recordsUpserted,
      recordsDiscarded,
      removed,
      renewed: 0,
    };
  }
}
