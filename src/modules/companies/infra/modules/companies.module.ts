import { Module } from '@nestjs/common';
import { ApiKeysModule } from '@modules/api-keys/infra/modules/api-keys.module.js';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { IbgeCnaeModule } from '@modules/ibge-cnae/infra/modules/ibge-cnae.module.js';
import { ReceitaModule } from '@modules/receita/infra/modules/receita.module.js';
import { CompanyProfileRepository } from '../../domain/dtos/repositories/company-profile.repository.js';
import { CompaniesController } from '../../http/controllers/companies.controller.js';
import { PublicCompaniesController } from '../../http/controllers/public-companies.controller.js';
import { PrismaCompanyProfileRepository } from '../db/repositories/prisma-company-profile.repository.js';
import { CompanyProfileProcessor } from '../queue/company-profile.processor.js';
import { GetCompanyProfileUseCase } from '../usecases/get-company-profile.usecase.js';
import { RefreshCompanyProfileUseCase } from '../usecases/refresh-company-profile.usecase.js';
import { ResolveCnaeDescriptionsUseCase } from '../usecases/resolve-cnae-descriptions.usecase.js';
import { SearchCompaniesByNameUseCase } from '../usecases/search-companies-by-name.usecase.js';

/**
 * Perfil cadastral de pessoas jurídicas: consulta por CNPJ e por nome,
 * pesquisa e exportação (UC06, UC08, UC09), e a consulta por chave de API
 * para sistemas de terceiros (UC12).
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
  imports: [DataSourcesModule, ApiKeysModule, ReceitaModule, IbgeCnaeModule],
  controllers: [CompaniesController, PublicCompaniesController],
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
    SearchCompaniesByNameUseCase,

    /* Consumidor da fila */
    CompanyProfileProcessor,
  ],
})
export class CompaniesModule {}
