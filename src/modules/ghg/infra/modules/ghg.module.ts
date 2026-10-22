import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { EvidencesModule } from '@modules/evidences/infra/modules/evidences.module.js';
import { CompaniesModule } from '@modules/companies/infra/modules/companies.module.js';
import { GhgDataSource } from '../providers/ghg.data-source.js';
import { GhgOrganizationDirectory } from '../providers/ghg-organization-directory.provider.js';
import { GhgReportReader } from '../providers/ghg-report-reader.provider.js';
import { GhgInventoryProcessor } from '../queue/ghg-inventory.processor.js';
import { CollectGhgInventoryUseCase } from '../usecases/collect-ghg-inventory.usecase.js';
import { GetGhgCompanyEvidencesUseCase } from '../usecases/get-ghg-company-evidences.usecase.js';
import { SyncGhgOrganizationsUseCase } from '../usecases/sync-ghg-organizations.usecase.js';
/**
 * Inventario GHG isolado, acionado exclusivamente pela fila propria: a coleta
 * de cada CNPJ e a sincronizacao diaria do cadastro de organizacoes.
 */
@Module({
  imports: [DataSourcesModule, EvidencesModule, CompaniesModule],
  providers: [
    GhgDataSource,
    GhgOrganizationDirectory,
    GhgReportReader,
    GhgInventoryProcessor,
    CollectGhgInventoryUseCase,
    GetGhgCompanyEvidencesUseCase,
    SyncGhgOrganizationsUseCase,
  ],
  exports: [GetGhgCompanyEvidencesUseCase],
})
export class GhgModule {}
