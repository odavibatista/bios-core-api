import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { DataSourceRepository } from '../../../domain/dtos/repositories/data-source.repository.js';
import {
  type IngestionRunRecord,
  IngestionRunRepository,
} from '../../../domain/dtos/repositories/ingestion-run.repository.js';
import { resolveSourceId } from './ingestion-source.js';

/**
 * A última execução bem-sucedida de uma fonte em lote, ou `null` (UC14).
 *
 * É a referência de dois assuntos: se o dump de hoje é o mesmo de ontem
 * (`dump_checksum`) e, para o job avulso, até quando a ausência de uma empresa
 * no dump vale como "não encontrado".
 *
 * @throws {UnknownDataSourceError} quando a fonte não existe no catálogo.
 */
@Injectable()
export class FindLastSucceededIngestionRunUseCase extends UseCase<
  string,
  IngestionRunRecord | null
> {
  constructor(
    private readonly dataSourceRepository: DataSourceRepository,
    private readonly ingestionRunRepository: IngestionRunRepository,
  ) {
    super();
  }

  override async execute(
    sourceSlug: string,
  ): Promise<IngestionRunRecord | null> {
    const dataSourceId = await resolveSourceId(
      this.dataSourceRepository,
      sourceSlug,
    );

    return this.ingestionRunRepository.findLastSucceeded(dataSourceId);
  }
}
