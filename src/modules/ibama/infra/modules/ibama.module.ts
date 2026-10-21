import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { IbamaDataSource } from '../providers/ibama.data-source.js';

/**
 * Adapter do IBAMA: download e leitura dos dumps de autos de infração e termos
 * de embargo (UC14).
 *
 * Um módulo por fonte externa (NFPD02). Não tem entidade nem endpoint: quem
 * ingere (o job diário, o job avulso) pede o dump, lê os registros de pessoa
 * jurídica e grava. O descarte de pessoa física acontece aqui, antes de
 * qualquer persistência (INL02).
 */
@Module({
  imports: [DataSourcesModule],
  providers: [IbamaDataSource],
  exports: [IbamaDataSource],
})
export class IbamaModule {}
