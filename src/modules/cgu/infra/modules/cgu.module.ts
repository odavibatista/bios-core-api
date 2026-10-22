import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { EvidencesModule } from '@modules/evidences/infra/modules/evidences.module.js';
import { CguSanctionsProvider } from '../providers/cgu-sanctions.provider.js';
import { CeisDataSource } from '../providers/ceis.data-source.js';
import { CnepDataSource } from '../providers/cnep.data-source.js';
import { GetCguCompanyEvidencesUseCase } from '../usecases/get-cgu-company-evidences.usecase.js';

/** Cadastros CGU isolados atrás dos contratos públicos de fontes/evidências. */
@Module({
  imports: [DataSourcesModule, EvidencesModule],
  providers: [
    CguSanctionsProvider,
    CeisDataSource,
    CnepDataSource,
    GetCguCompanyEvidencesUseCase,
  ],
  exports: [CeisDataSource, CnepDataSource, GetCguCompanyEvidencesUseCase],
})
export class CguModule {}
