import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import {
  type IngestionRunOutcome,
  IngestionRunRepository,
} from '../../../domain/dtos/repositories/ingestion-run.repository.js';

/**
 * Tamanho máximo da mensagem de erro guardada na execução. A mensagem vem de
 * uma exceção qualquer e pode ser longa; o que importa para o diagnóstico cabe
 * no começo, e o registro não deve crescer sem limite.
 */
export const MAX_RUN_ERROR_MESSAGE_LENGTH = 500;

export interface FinishIngestionRunInput extends Omit<
  IngestionRunOutcome,
  'finishedAt'
> {
  /** Execução a encerrar (`ingestion_runs.id_ingestion_run`). */
  runId: string;

  /** Término; o instante da chamada quando ausente. */
  finishedAt?: Date;
}

/** Encerra uma execução de ingestão com o resultado (UC14). */
@Injectable()
export class FinishIngestionRunUseCase extends UseCase<
  FinishIngestionRunInput,
  void
> {
  constructor(private readonly ingestionRunRepository: IngestionRunRepository) {
    super();
  }

  override async execute({
    runId,
    errorMessage,
    finishedAt,
    ...outcome
  }: FinishIngestionRunInput): Promise<void> {
    await this.ingestionRunRepository.finish(runId, {
      ...outcome,
      errorMessage: errorMessage?.slice(0, MAX_RUN_ERROR_MESSAGE_LENGTH),
      finishedAt: finishedAt ?? new Date(),
    });
  }
}
