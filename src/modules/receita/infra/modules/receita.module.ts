import { Module } from '@nestjs/common';
import { BrasilApiModule } from '@modules/brasil-api/infra/modules/brasil-api.module.js';
import { BrasilApiDataSource } from '@modules/brasil-api/infra/providers/brasil-api.data-source.js';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { MinhaReceitaModule } from '@modules/minha-receita/infra/modules/minha-receita.module.js';
import { MinhaReceitaDataSource } from '@modules/minha-receita/infra/providers/minha-receita.data-source.js';
import { OpenCnpjModule } from '@modules/opencnpj/infra/modules/opencnpj.module.js';
import { OpenCnpjDataSource } from '@modules/opencnpj/infra/providers/opencnpj.data-source.js';
import { CADASTRAL_DATA_SOURCES } from '../../domain/cadastral-data-sources.token.js';
import { ReceitaDataSource } from '../providers/receita.data-source.js';

/**
 * Cadeia de fallback do cadastro por CNPJ: BrasilAPI → OpenCNPJ → Minha
 * Receita (RF03).
 *
 * Reúne os adapters dos três provedores e os consulta na ordem do catálogo.
 * Quem precisa do cadastro (a ingestão que grava `company_profile`) importa
 * este módulo e usa `ReceitaDataSource`; não conhece os provedores.
 */
@Module({
  imports: [
    DataSourcesModule,
    BrasilApiModule,
    OpenCnpjModule,
    MinhaReceitaModule,
  ],
  providers: [
    {
      provide: CADASTRAL_DATA_SOURCES,
      inject: [BrasilApiDataSource, OpenCnpjDataSource, MinhaReceitaDataSource],
      useFactory: (
        brasilApi: BrasilApiDataSource,
        openCnpj: OpenCnpjDataSource,
        minhaReceita: MinhaReceitaDataSource,
      ) => [brasilApi, openCnpj, minhaReceita],
    },
    ReceitaDataSource,
  ],
  exports: [ReceitaDataSource],
})
export class ReceitaModule {}
