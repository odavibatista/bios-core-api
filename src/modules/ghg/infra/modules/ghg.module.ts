import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { EvidencesModule } from '@modules/evidences/infra/modules/evidences.module.js';
import { CompaniesModule } from '@modules/companies/infra/modules/companies.module.js';
import { GhgDataSource } from '../providers/ghg.data-source.js';
import { GhgReportReader } from '../providers/ghg-report-reader.provider.js';
import { GhgInventoryProcessor } from '../queue/ghg-inventory.processor.js';
import { CollectGhgInventoryUseCase } from '../usecases/collect-ghg-inventory.usecase.js';
import { GetGhgCompanyEvidencesUseCase } from '../usecases/get-ghg-company-evidences.usecase.js';
/** Inventario GHG isolado, acionado exclusivamente pela fila propria. */
@Module({
  imports: [DataSourcesModule, EvidencesModule, CompaniesModule],
  providers: [
    GhgDataSource,
    GhgReportReader,
    GhgInventoryProcessor,
    CollectGhgInventoryUseCase,
    GetGhgCompanyEvidencesUseCase,
  ],
  exports: [GetGhgCompanyEvidencesUseCase],
})
export class GhgModule {}
