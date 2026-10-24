import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { IbgeCnaeModule } from '@modules/ibge-cnae/infra/modules/ibge-cnae.module.js';
import { ReceitaModule } from '@modules/receita/infra/modules/receita.module.js';
import { ScoringModule } from '@modules/scoring/infra/modules/scoring.module.js';
import { CompanyProfileRepository } from '../../domain/dtos/repositories/company-profile.repository.js';
import { CompaniesController } from '../../http/controllers/companies.controller.js';
import { CompaniesExportController } from '../../http/controllers/companies-export.controller.js';
import { PrismaCompanyProfileRepository } from '../db/repositories/prisma-company-profile.repository.js';
import { CompanyProfileProcessor } from '../queue/company-profile.processor.js';
import { ExportCompaniesUseCase } from '../usecases/export-companies.usecase.js';
import { GetCompanyProfileUseCase } from '../usecases/get-company-profile.usecase.js';
import { RefreshCompanyProfileUseCase } from '../usecases/refresh-company-profile.usecase.js';
import { ResolveCnaeDescriptionsUseCase } from '../usecases/resolve-cnae-descriptions.usecase.js';
import { SearchCompaniesUseCase } from '../usecases/search-companies.usecase.js';

/**
 * Perfil cadastral de pessoas jurídicas: consulta por CNPJ e por nome,
 * pesquisa e exportação (UC06, UC08, UC09). A rota do perfil completo (cadastro +
 * perfil ambiental) e a consulta por chave de API (UC12) moram no
 * `EnvironmentalIntelligenceModule`, que compõe este módulo com evidências e índices.
 *
 * Entidades (schemas Prisma em `../../entity`): `CompanyProfile`.
 *
 * A consulta não fala com os provedores: lê o banco e, quando o cadastro falta
 * ou venceu, publica o pedido na fila `company-profile` (contrato em
 * `company-profile-job.dto.ts`) e espera. Quem atende a fila é o
 * `CompanyProfileProcessor`, hospedado aqui: percorre a cadeia de provedores
 * (`ReceitaModule`), completa a descrição dos CNAEs com a do IBGE
 * (`IbgeCnaeModule`) e grava `company_profile`. A janela de validade do cache
 * vem do catálogo de fontes (`DataSourcesModule`).
 */
@Module({
  imports: [DataSourcesModule, ReceitaModule, IbgeCnaeModule, ScoringModule],
  controllers: [CompaniesController, CompaniesExportController],
  exports: [CompanyProfileRepository, GetCompanyProfileUseCase],
  providers: [
    /* Repositórios */
    {
      provide: CompanyProfileRepository,
      useClass: PrismaCompanyProfileRepository,
    },

    /* Casos de uso */
    GetCompanyProfileUseCase,
    RefreshCompanyProfileUseCase,
    ResolveCnaeDescriptionsUseCase,
    SearchCompaniesUseCase,
    ExportCompaniesUseCase,

    /* Consumidor da fila */
    CompanyProfileProcessor,
  ],
})
export class CompaniesModule {}
