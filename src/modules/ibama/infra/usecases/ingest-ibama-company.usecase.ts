import { Injectable, Logger } from '@nestjs/common';
import { IngestionRunStatus, RequestTrigger } from '@prisma/client';
import { SourceOutcome } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { OpenIngestionRunUseCase } from '@modules/data-sources/infra/usecases/ingestion/open-ingestion-run.usecase.js';
import { FinishIngestionRunUseCase } from '@modules/data-sources/infra/usecases/ingestion/finish-ingestion-run.usecase.js';
import type { EvidenceBatchEntry } from '@modules/evidences/domain/dtos/providers/evidence-batch.dto.js';
import { RecordEvidenceEntriesUseCase } from '@modules/evidences/infra/usecases/record-evidence-entries.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { InvalidEvidenceError } from '@modules/evidences/domain/dtos/errors/evidence.errors.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import type { IbamaCompanyJobResult } from '../../domain/dtos/providers/ibama-company-job.dto.js';
import type { IbamaDump } from '../../domain/dtos/providers/ibama-dump.dto.js';
import {
  IbamaDumpUnavailableError,
  IbamaSourceDisabledError,
} from '../../domain/dtos/errors/ibama-ingestion.errors.js';
import { combineDumpChecksums } from '../../domain/ibama-dump-checksum.js';
import { toEvidenceEntry } from '../../domain/ibama-evidence.mapper.js';
import { IbamaResource } from '../../domain/ibama-resource.js';
import { IBAMA_SLUG, IbamaDataSource } from '../providers/ibama.data-source.js';

export interface IngestIbamaCompanyInput {
  jobId: string;
  cnpj: string;
}

/**
 * Lê os dois dumps completos, guardando somente entradas do CNPJ solicitado.
 * A ausência só é confirmada após ambos terminarem: um 404, erro de formato ou
 * falha no segundo recurso nunca pode apagar o retrato anterior da empresa.
 */
@Injectable()
export class IngestIbamaCompanyUseCase extends UseCase<
  IngestIbamaCompanyInput,
  IbamaCompanyJobResult
> {
  private readonly logger = new Logger(IngestIbamaCompanyUseCase.name);

  constructor(
    private readonly source: IbamaDataSource,
    private readonly openRun: OpenIngestionRunUseCase,
    private readonly finishRun: FinishIngestionRunUseCase,
    private readonly recordEntries: RecordEvidenceEntriesUseCase,
    private readonly recordCollection: RecordEvidenceCollectionUseCase,
  ) {
    super();
  }

  override async execute({
    jobId,
    cnpj,
  }: IngestIbamaCompanyInput): Promise<IbamaCompanyJobResult> {
    if (parseCnpj(cnpj) !== cnpj)
      throw new InvalidEvidenceError('CNPJ avulso deve ser canônico e válido.');
    const collectedAt = new Date();
    const run = await this.openRun.execute({
      sourceSlug: IBAMA_SLUG,
      jobId,
      cnpj,
      startedAt: collectedAt,
    });
    const dumps: IbamaDump[] = [];
    try {
      const failures = [];
      for (const resource of [
        IbamaResource.AUTO_INFRACAO,
        IbamaResource.TERMO_EMBARGO,
      ]) {
        const result = await this.source.download(resource, {
          trigger: RequestTrigger.ON_DEMAND_JOB,
          ingestionRunId: run.id,
        });
        if (result.status === 'FOUND') dumps.push(result.data);
        else if (
          result.status === 'UNAVAILABLE' &&
          result.reason === SourceOutcome.DISABLED
        )
          throw new IbamaSourceDisabledError();
        else
          failures.push({
            resource,
            reason:
              result.status === 'UNAVAILABLE'
                ? (result.message ?? result.reason)
                : 'dump não encontrado',
          });
      }
      if (failures.length) throw new IbamaDumpUnavailableError(failures);
      const entries: EvidenceBatchEntry[] = [];
      let recordsRead = 0;
      let recordsDiscarded = 0;
      for (const dump of dumps) {
        for await (const record of dump.records()) {
          if (record.cnpj !== cnpj) {
            recordsDiscarded += 1;
            continue;
          }
          const entry = toEvidenceEntry(record);
          if (entry) entries.push(entry);
          else recordsDiscarded += 1;
        }
        recordsRead += dump.stats.rows;
        recordsDiscarded += Object.values(dump.stats.discarded).reduce(
          (sum, value) => sum + value,
          0,
        );
      }
      const { saved, removed } = await this.recordEntries.execute({
        cnpj,
        sourceSlug: IBAMA_SLUG,
        entries,
        collectedAt,
        ingestionRunId: run.id,
      });
      const dumpChecksum = combineDumpChecksums(dumps);
      await this.finishRun.execute({
        runId: run.id,
        status: IngestionRunStatus.SUCCEEDED,
        dumpChecksum,
        recordsRead,
        recordsUpserted: saved,
        recordsDiscarded,
      });
      return {
        outcome: 'SUCCEEDED',
        cnpj,
        ingestionRunId: run.id,
        dumpChecksum,
        recordsRead,
        recordsUpserted: saved,
        recordsDiscarded,
        removed,
      };
    } catch (error) {
      try {
        await this.recordCollection.execute({
          cnpj,
          sourceSlug: IBAMA_SLUG,
          result: { status: 'UNAVAILABLE' },
          collectedAt,
        });
      } catch {
        this.logger.warn(
          'Não foi possível registrar a indisponibilidade da coleta avulsa do IBAMA.',
        );
      }
      throw error;
    } finally {
      await Promise.allSettled(dumps.map((dump) => dump.dispose()));
    }
  }
}
