import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { OpenCnpjDataSource } from '../providers/opencnpj.data-source.js';

/**
 * Adapter do OpenCNPJ: primeiro fallback do cadastro por CNPJ (RF03).
 *
 * Um módulo por fonte externa (NFPD02). Não tem entidade nem endpoint: a
 * fonte é consumida pela cadeia de fallback cadastral, que o importa.
 */
@Module({
  imports: [DataSourcesModule],
  providers: [OpenCnpjDataSource],
  exports: [OpenCnpjDataSource],
})
export class OpenCnpjModule {}
