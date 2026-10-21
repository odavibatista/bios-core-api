import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { EvidencesModule } from '@modules/evidences/infra/modules/evidences.module.js';
import { IbamaDataSource } from '../providers/ibama.data-source.js';
import { NormalizeIbamaRecordsUseCase } from '../usecases/normalize-ibama-records.usecase.js';

/**
 * IBAMA: download e leitura dos dumps de autos de infração e termos de embargo,
 * e normalização dos registros em evidências (UC14).
 *
 * Um módulo por fonte externa (NFPD02). Não tem entidade nem endpoint: quem
 * ingere (o job diário, o job avulso) pede o dump (`IbamaDataSource`), lê os
 * registros de pessoa jurídica e os normaliza em evidências
 * (`NormalizeIbamaRecordsUseCase`). O descarte de pessoa física acontece na
 * leitura, antes de qualquer persistência (INL02).
 */
@Module({
  imports: [DataSourcesModule, EvidencesModule],
  providers: [IbamaDataSource, NormalizeIbamaRecordsUseCase],
  exports: [IbamaDataSource, NormalizeIbamaRecordsUseCase],
})
export class IbamaModule {}
