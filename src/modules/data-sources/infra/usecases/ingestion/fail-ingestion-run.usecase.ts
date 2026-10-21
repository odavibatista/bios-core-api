import { Injectable } from '@nestjs/common';
import { IngestionRunStatus } from '@prisma/client';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { DataSourceRepository } from '../../../domain/dtos/repositories/data-source.repository.js';
import { IngestionRunRepository } from '../../../domain/dtos/repositories/ingestion-run.repository.js';
import { FinishIngestionRunUseCase } from './finish-ingestion-run.usecase.js';
import { resolveSourceId } from './ingestion-source.js';

export interface FailIngestionRunInput {
  /** Fonte ingerida (`data_sources.slug`). */
  sourceSlug: string;

  /** Job BullMQ cuja execução falhou em definitivo. */
  jobId: string;

  /** Por que falhou. Sem dado pessoal: vai para o registro da execução. */
  errorMessage: string;
}

/**
 * Marca como `FAILED` a execução de um job que esgotou as tentativas (UC14,
 * fluxo 2.1).
 *
 * É chamado por quem consome a fila, que é quem sabe que a tentativa foi a
 * última. Devolve `false` quando o job não chegou a abrir uma execução (o
 * banco estava fora já no começo, por exemplo): não há o que marcar.
 *
 * Falhar a execução não remove evidência alguma: o que a fonte já entregou
 * segue valendo até o fim da própria janela de validade.
 *
 * @throws {UnknownDataSourceError} quando a fonte não existe no catálogo.
 */
@Injectable()
export class FailIngestionRunUseCase extends UseCase<
  FailIngestionRunInput,
  boolean
> {
  constructor(
    private readonly dataSourceRepository: DataSourceRepository,
    private readonly ingestionRunRepository: IngestionRunRepository,
    private readonly finishIngestionRun: FinishIngestionRunUseCase,
  ) {
    super();
  }

  override async execute({
    sourceSlug,
    jobId,
    errorMessage,
  }: FailIngestionRunInput): Promise<boolean> {
    const dataSourceId = await resolveSourceId(
      this.dataSourceRepository,
      sourceSlug,
    );
    const run = await this.ingestionRunRepository.findByJob(
      dataSourceId,
      jobId,
    );

    if (!run) return false;

    await this.finishIngestionRun.execute({
      runId: run.id,
      status: IngestionRunStatus.FAILED,
      recordsRead: 0,
      recordsUpserted: 0,
      recordsDiscarded: 0,
      errorMessage,
    });

    return true;
  }
}
