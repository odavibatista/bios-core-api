import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { CompanyProfileRepository } from '../../domain/dtos/repositories/company-profile.repository.js';
import { CompaniesController } from '../../http/controllers/companies.controller.js';
import { PrismaCompanyProfileRepository } from '../db/repositories/prisma-company-profile.repository.js';
import { GetCompanyProfileUseCase } from '../usecases/get-company-profile.usecase.js';

/**
 * Perfil cadastral de pessoas jurídicas: consulta por CNPJ e por nome,
 * pesquisa e exportação (UC06, UC08, UC09).
 *
 * Entidades (schemas Prisma em `../../entity`): `CompanyProfile`.
 *
 * O core não consulta os provedores cadastrais: pede a atualização ao serviço
 * de ingestão do CNPJ pela fila `company-profile` (contrato em
 * `company-profile-job.dto.ts`) e lê o resultado do banco. A janela de validade
 * do cache vem do catálogo de fontes (`DataSourcesModule`).
 */
@Module({
  imports: [DataSourcesModule],
  controllers: [CompaniesController],
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
