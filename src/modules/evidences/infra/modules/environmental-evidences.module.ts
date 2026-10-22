import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { IbamaModule } from '@modules/ibama/infra/modules/ibama.module.js';
import { CguModule } from '@modules/cgu/infra/modules/cgu.module.js';
import { GhgModule } from '@modules/ghg/infra/modules/ghg.module.js';
import { EvidencesModule } from './evidences.module.js';
import { EnvironmentalEvidencesProcessor } from '../queue/environmental-evidences.processor.js';
import { RequestCguCompanyEvidencesUseCase } from '../usecases/request-cgu-company-evidences.usecase.js';
import { GetCompanyEnvironmentalEvidencesUseCase } from '../usecases/get-company-environmental-evidences.usecase.js';
/** Orquestracao acima dos adapters; o armazenamento nao depende deles. */
@Module({
  imports: [
    DataSourcesModule,
    EvidencesModule,
    IbamaModule,
    CguModule,
    GhgModule,
  ],
  providers: [
    EnvironmentalEvidencesProcessor,
    RequestCguCompanyEvidencesUseCase,
    GetCompanyEnvironmentalEvidencesUseCase,
  ],
  exports: [GetCompanyEnvironmentalEvidencesUseCase],
})
export class EnvironmentalEvidencesModule {}
