import { Module } from '@nestjs/common';
import { ApiKeysModule } from '@modules/api-keys/infra/modules/api-keys.module.js';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { CompanyProfileRepository } from '../../domain/dtos/repositories/company-profile.repository.js';
import { CompaniesController } from '../../http/controllers/companies.controller.js';
import { PublicCompaniesController } from '../../http/controllers/public-companies.controller.js';
import { PrismaCompanyProfileRepository } from '../db/repositories/prisma-company-profile.repository.js';
import { GetCompanyProfileUseCase } from '../usecases/get-company-profile.usecase.js';

/**
 * Perfil cadastral de pessoas jurídicas: consulta por CNPJ e por nome,
 * pesquisa e exportação (UC06, UC08, UC09), e a consulta por chave de API
 * para sistemas de terceiros (UC12).
 *
 * Entidades (schemas Prisma em `../../entity`): `CompanyProfile`.
 *
 * O core não consulta os provedores cadastrais: pede a atualização ao serviço
 * de ingestão do CNPJ pela fila `company-profile` (contrato em
 * `company-profile-job.dto.ts`) e lê o resultado do banco. A janela de validade
 * do cache vem do catálogo de fontes (`DataSourcesModule`).
 */
@Module({
  imports: [DataSourcesModule, ApiKeysModule],
  controllers: [CompaniesController, PublicCompaniesController],
  providers: [
    /* Repositórios */
    {
      provide: CompanyProfileRepository,
      useClass: PrismaCompanyProfileRepository,
    },

    /* Casos de uso */
    GetCompanyProfileUseCase,
  ],
})
export class CompaniesModule {}
