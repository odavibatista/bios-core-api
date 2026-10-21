import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { DataSourceRepository } from '../../../domain/dtos/repositories/data-source.repository.js';
import {
  type IngestionRunRecord,
  IngestionRunRepository,
} from '../../../domain/dtos/repositories/ingestion-run.repository.js';
import { resolveSourceId } from './ingestion-source.js';

export interface OpenIngestionRunInput {
  /** Fonte ingerida (`data_sources.slug`). */
  sourceSlug: string;

  /** Job BullMQ da execução. As tentativas do mesmo job reaproveitam a mesma linha. */
  jobId: string;

  /** Presente apenas na execução avulsa, já canônico e validado. */
  cnpj?: string;

  /** Início da tentativa. */
  startedAt: Date;
}

/**
 * Abre a execução de um job de ingestão, agendado ou avulso por CNPJ, em `RUNNING` (UC14).
 *
 * Uma execução por job: se o job foi repetido depois de uma falha, a execução
 * dele é reaberta, e não duplicada (ver `IngestionRunRepository.openScheduled`).
 * O `started_at` passa a ser o da tentativa em andamento, que é também a data
 * de coleta de tudo o que ela grava: quem precisar saber o que uma execução
 * tocou encontra no `started_at` o corte.
 *
 * @throws {UnknownDataSourceError} quando a fonte não existe no catálogo.
 */
@Injectable()
export class OpenIngestionRunUseCase extends UseCase<
  OpenIngestionRunInput,
  IngestionRunRecord
> {
  constructor(
    private readonly dataSourceRepository: DataSourceRepository,
    private readonly ingestionRunRepository: IngestionRunRepository,
  ) {
    super();
  }

  override async execute({
    sourceSlug,
    jobId,
    startedAt,
    cnpj,
  }: OpenIngestionRunInput): Promise<IngestionRunRecord> {
    const dataSourceId = await resolveSourceId(
      this.dataSourceRepository,
      sourceSlug,
    );

    if (cnpj !== undefined) {
      return this.ingestionRunRepository.openOnDemand({
        dataSourceId,
        jobId,
        startedAt,
        cnpj,
      });
    }

    return this.ingestionRunRepository.openScheduled({
      dataSourceId,
      jobId,
      startedAt,
    });
  }
}
