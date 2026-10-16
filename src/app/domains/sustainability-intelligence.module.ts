import { Module } from '@nestjs/common';
import { BrasilApiModule } from '@modules/brasil-api/infra/modules/brasil-api.module.js';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { EvidencesModule } from '@modules/evidences/infra/modules/evidences.module.js';
import { OpenCnpjModule } from '@modules/opencnpj/infra/modules/opencnpj.module.js';
import { CompaniesModule } from '@modules/companies/infra/modules/companies.module.js';
import { ScoringModule } from '@modules/scoring/infra/modules/scoring.module.js';

/**
 * Agregador do domínio de inteligência socioambiental: fontes de dados e seus
 * adapters, evidências, perfis de empresas e índices de aderência aos ODS.
 */
@Module({
  imports: [
    DataSourcesModule,
    BrasilApiModule,
    OpenCnpjModule,
    EvidencesModule,
    CompaniesModule,
    ScoringModule,
  ],
})
export class SustainabilityIntelligenceModule {}
