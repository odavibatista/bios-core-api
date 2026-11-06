import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { ViaCepDataSource } from '../providers/viacep.data-source.js';

/**
 * Adapter do ViaCEP: endereço a partir do CEP (RF39).
 *
 * Um módulo por fonte externa (NFPD02). Não tem entidade nem endpoint: quem expõe a consulta é o
 * módulo de localidades, que confere o município no catálogo.
 */
@Module({
  imports: [DataSourcesModule],
  providers: [ViaCepDataSource],
  exports: [ViaCepDataSource],
})
export class ViaCepModule {}
