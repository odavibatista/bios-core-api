import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { EvidencesModule } from '@modules/evidences/infra/modules/evidences.module.js';
import { IbamaIngestionProcessor } from '../queue/ibama-ingestion.processor.js';
import { IbamaDataSource } from '../providers/ibama.data-source.js';
import { IngestIbamaCompanyUseCase } from '../usecases/ingest-ibama-company.usecase.js';
import { GetIbamaCompanyEvidencesUseCase } from '../usecases/get-ibama-company-evidences.usecase.js';
import { IngestIbamaDumpsUseCase } from '../usecases/ingest-ibama-dumps.usecase.js';
import { NormalizeIbamaRecordsUseCase } from '../usecases/normalize-ibama-records.usecase.js';

/**
 * IBAMA: download e leitura dos dumps de autos de infração e termos de embargo,
 * normalização dos registros em evidências e o lote diário que os ingere (UC14).
 *
 * Um módulo por fonte externa (NFPD02). Não tem entidade nem endpoint: quem
 * ingere pede o dump (`IbamaDataSource`), lê os registros de pessoa jurídica e
 * os normaliza em evidências (`NormalizeIbamaRecordsUseCase`). O descarte de
 * pessoa física acontece na leitura, antes de qualquer persistência (INL02).
 *
 * Hospeda o consumidor da fila `environmental-evidences`
 * (`IbamaIngestionProcessor`), que executa o lote diário
 * (`IngestIbamaDumpsUseCase`) disparado pelo agendador (`QUEUE_SCHEDULES`)
 * e a coleta avulsa (`IngestIbamaCompanyUseCase`). A consulta local e publicação
 * sem espera ficam em `GetIbamaCompanyEvidencesUseCase`, exportado ao perfil.
 */
@Module({
  imports: [DataSourcesModule, EvidencesModule],
  providers: [
    IbamaDataSource,
    NormalizeIbamaRecordsUseCase,
    IngestIbamaDumpsUseCase,
    IngestIbamaCompanyUseCase,
    GetIbamaCompanyEvidencesUseCase,
    IbamaIngestionProcessor,
  ],
  exports: [
    IbamaDataSource,
    NormalizeIbamaRecordsUseCase,
    IngestIbamaDumpsUseCase,
    IngestIbamaCompanyUseCase,
    GetIbamaCompanyEvidencesUseCase,
  ],
})
export class IbamaModule {}
