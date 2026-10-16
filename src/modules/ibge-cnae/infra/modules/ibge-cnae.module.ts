import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { IbgeCnaeDataSource } from '../providers/ibge-cnae.data-source.js';

/**
 * Adapter do IBGE: descrição textual dos CNAEs (RF06).
 *
 * Um módulo por fonte externa (NFPD02). Não tem entidade nem endpoint: a
 * descrição é pedida por quem monta o perfil da empresa.
 */
@Module({
  imports: [DataSourcesModule],
  providers: [IbgeCnaeDataSource],
  exports: [IbgeCnaeDataSource],
})
export class IbgeCnaeModule {}
