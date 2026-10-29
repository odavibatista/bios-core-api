import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Honeypot } from '@modules/security/http/decorators/honeypot.decorator.js';
import {
  type DecoyCompany,
  type DecoyCompanyListQuery,
  DecoyCompanyListQuerySchema,
  type DecoyCompanyListResponse,
  type DecoyCompanyParams,
  DecoyCompanyParamsSchema,
} from '../../domain/dtos/requests/decoy-company.dto.js';
import {
  GetDecoyCompanyUseCase,
  ListDecoyCompaniesUseCase,
} from '../../infra/usecases/decoy-companies.usecases.js';

/**
 * Endpoints isca (RF21, NFSE07, #88): imitam uma versão nova da API pública de empresas,
 * que não existe (a real é `/v1/companies/:cnpj`, sem listagem). Ninguém chega a eles pela
 * documentação: só quem varre caminhos.
 *
 * Cada chamada passa pelo `@Honeypot()` (registro e bloqueio do IP) e responde com dados
 * sintéticos, em baixo volume e com baixa disponibilidade proposital.
 */
@ApiExcludeController()
@Controller('v2/companies')
export class DecoyCompaniesController {
  constructor(
    private readonly listUseCase: ListDecoyCompaniesUseCase,
    private readonly getUseCase: GetDecoyCompanyUseCase,
  ) {}

  @Get()
  @Honeypot()
  list(
    @Query({ schema: DecoyCompanyListQuerySchema })
    query: DecoyCompanyListQuery,
  ): Promise<DecoyCompanyListResponse> {
    return this.listUseCase.execute(query);
  }

  @Get(':cnpj')
  @Honeypot()
  get(
    @Param({ schema: DecoyCompanyParamsSchema }) params: DecoyCompanyParams,
  ): Promise<DecoyCompany> {
    return this.getUseCase.execute(params.cnpj);
  }
}
