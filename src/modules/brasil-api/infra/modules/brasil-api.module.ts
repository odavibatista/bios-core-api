import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { BrasilApiDataSource } from '../providers/brasil-api.data-source.js';

/**
 * Adapter da BrasilAPI: provedor principal do cadastro por CNPJ (RF03).
 *
 * Um módulo por fonte externa (NFPD02). Não tem entidade nem endpoint: a
 * fonte é consumida pela cadeia de fallback cadastral, que o importa.
 */
@Module({
  imports: [DataSourcesModule],
  providers: [BrasilApiDataSource],
  exports: [BrasilApiDataSource],
})
export class BrasilApiModule {}
