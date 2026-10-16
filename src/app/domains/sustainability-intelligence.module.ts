import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { EvidencesModule } from '@modules/evidences/infra/modules/evidences.module.js';
import { ReceitaModule } from '@modules/receita/infra/modules/receita.module.js';
import { CompaniesModule } from '@modules/companies/infra/modules/companies.module.js';
import { ScoringModule } from '@modules/scoring/infra/modules/scoring.module.js';

/**
 * Agregador do domínio de inteligência socioambiental: fontes de dados e seus
 * adapters, evidências, perfis de empresas e índices de aderência aos ODS.
 *
 * `ReceitaModule` traz consigo os adapters dos provedores cadastrais
 * (BrasilAPI, OpenCNPJ, Minha Receita).
 */
@Module({
  imports: [
    DataSourcesModule,
    ReceitaModule,
    EvidencesModule,
    CompaniesModule,
    ScoringModule,
  ],
})
export class SustainabilityIntelligenceModule {}
