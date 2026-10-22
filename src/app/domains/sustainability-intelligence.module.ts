import { Module } from '@nestjs/common';
import { GhgModule } from '@modules/ghg/infra/modules/ghg.module.js';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { EvidencesModule } from '@modules/evidences/infra/modules/evidences.module.js';
import { IbamaModule } from '@modules/ibama/infra/modules/ibama.module.js';
import { IbgeCnaeModule } from '@modules/ibge-cnae/infra/modules/ibge-cnae.module.js';
import { ReceitaModule } from '@modules/receita/infra/modules/receita.module.js';
import { CompaniesModule } from '@modules/companies/infra/modules/companies.module.js';
import { ScoringModule } from '@modules/scoring/infra/modules/scoring.module.js';
import { CguModule } from '@modules/cgu/infra/modules/cgu.module.js';

/**
 * Agregador do domínio de inteligência socioambiental: fontes de dados e seus
 * adapters, evidências, perfis de empresas e índices de aderência aos ODS.
 *
 * `ReceitaModule` traz consigo os adapters dos provedores cadastrais
 * (BrasilAPI, OpenCNPJ, Minha Receita); `IbamaModule`, o do lote diário do
 * IBAMA.
 */
@Module({
  imports: [
    DataSourcesModule,
    ReceitaModule,
    IbgeCnaeModule,
    IbamaModule,
    CguModule,
    GhgModule,
    EvidencesModule,
    CompaniesModule,
    ScoringModule,
  ],
})
export class SustainabilityIntelligenceModule {}
