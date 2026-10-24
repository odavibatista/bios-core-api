import { Module } from '@nestjs/common';
import { ApiKeysModule } from '@modules/api-keys/infra/modules/api-keys.module.js';
import { CompanyProfileController } from '../../http/controllers/company-profile.controller.js';
import { PublicCompanyProfileController } from '../../http/controllers/public-company-profile.controller.js';
import { EnvironmentalEvidencesController } from '../../http/controllers/environmental-evidences.controller.js';
import { CompaniesModule } from '@modules/companies/infra/modules/companies.module.js';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { IbamaModule } from '@modules/ibama/infra/modules/ibama.module.js';
import { CguModule } from '@modules/cgu/infra/modules/cgu.module.js';
import { GhgModule } from '@modules/ghg/infra/modules/ghg.module.js';
import { ScoringModule } from '@modules/scoring/infra/modules/scoring.module.js';
import { EvidencesModule } from '@modules/evidences/infra/modules/evidences.module.js';
import { EnvironmentalEvidencesProcessor } from '../queue/environmental-evidences.processor.js';
import { RequestCguCompanyEvidencesUseCase } from '../usecases/request-cgu-company-evidences.usecase.js';
import { GetCompanyFullProfileUseCase } from '../usecases/get-company-full-profile.usecase.js';
import { GetCompanyEnvironmentalEvidencesUseCase } from '../usecases/get-company-environmental-evidences.usecase.js';
/** Orquestracao acima dos adapters; o armazenamento nao depende deles. */
@Module({
  imports: [
    ApiKeysModule,
    CompaniesModule,
    DataSourcesModule,
    EvidencesModule,
    IbamaModule,
    CguModule,
    GhgModule,
    ScoringModule,
  ],
  controllers: [
    EnvironmentalEvidencesController,
    CompanyProfileController,
    PublicCompanyProfileController,
  ],
  providers: [
    EnvironmentalEvidencesProcessor,
    RequestCguCompanyEvidencesUseCase,
    GetCompanyEnvironmentalEvidencesUseCase,
    GetCompanyFullProfileUseCase,
  ],
  exports: [GetCompanyEnvironmentalEvidencesUseCase],
})
export class EnvironmentalIntelligenceModule {}
