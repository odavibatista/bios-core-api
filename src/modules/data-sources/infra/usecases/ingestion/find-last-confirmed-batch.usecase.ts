import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { DataSourceRepository } from '../../../domain/dtos/repositories/data-source.repository.js';
import {
  IngestionRunRepository,
  type IngestionRunRecord,
} from '../../../domain/dtos/repositories/ingestion-run.repository.js';
import { resolveSourceId } from './ingestion-source.js';

/**
 * Referência do índice completo da fonte (UC14, fluxo 1.1).
 *
 * Um skip reconfirma o lote e renova sua validade; uma execução avulsa não
 * permite concluir nada sobre as empresas que ela não consultou.
 */
@Injectable()
export class FindLastConfirmedBatchUseCase extends UseCase<
  string,
  IngestionRunRecord | null
> {
  constructor(
    private readonly sources: DataSourceRepository,
    private readonly runs: IngestionRunRepository,
  ) {
    super();
  }

  override async execute(
    sourceSlug: string,
  ): Promise<IngestionRunRecord | null> {
    return this.runs.findLastConfirmedBatch(
      await resolveSourceId(this.sources, sourceSlug),
    );
  }
}
