import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { EvidencesModule } from '@modules/evidences/infra/modules/evidences.module.js';
import { CompaniesModule } from '@modules/companies/infra/modules/companies.module.js';
import { ScoringModule } from '@modules/scoring/infra/modules/scoring.module.js';

/**
 * Agregador do domínio de inteligência socioambiental: fontes de dados,
 * evidências, perfis de empresas e índices de aderência aos ODS.
 */
@Module({
  imports: [DataSourcesModule, EvidencesModule, CompaniesModule, ScoringModule],
})
export class SustainabilityIntelligenceModule {}
