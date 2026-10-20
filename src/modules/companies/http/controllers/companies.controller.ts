import { Controller, Get, HttpStatus, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ErrorResponses,
  ResponseSchema,
} from '@shared/http/decorators/response-schema.decorator.js';
import type {
  CompaniesControllerInterface,
  CompaniesSearchControllerInterface,
} from '../../domain/dtos/controllers/companies.controller.dto.js';
import {
  type CompanyProfileResponse,
  CompanyProfileResponseSchema,
} from '../../domain/dtos/requests/company-profile.dto.js';
import {
  type SearchCompaniesQuery,
  SearchCompaniesQuerySchema,
  type SearchCompaniesResponse,
  SearchCompaniesResponseSchema,
} from '../../domain/dtos/requests/search-companies.dto.js';
import { GetCompanyProfileUseCase } from '../../infra/usecases/get-company-profile.usecase.js';
import { SearchCompaniesByNameUseCase } from '../../infra/usecases/search-companies-by-name.usecase.js';

// Privado, como toda rota sem `@Public()`: consultar empresas exige sessão (RF02).
@ApiTags('Empresas')
@ApiBearerAuth('jwt')
@Controller('companies')
export class CompaniesController
  implements CompaniesControllerInterface, CompaniesSearchControllerInterface
{
  constructor(
    private readonly getCompanyProfileUseCase: GetCompanyProfileUseCase,
    private readonly searchCompaniesByNameUseCase: SearchCompaniesByNameUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Busca empresas por razão social ou nome fantasia',
    description:
      'Procura entre as empresas já consultadas pelo BIOS (nenhuma fonte cadastral oferece busca por nome): devolve as que têm, na razão social ou no nome fantasia, uma palavra começando por cada palavra digitada, em qualquer ordem. Acentos e caixa são ignorados. Quem começa pela frase digitada vem primeiro. Para abrir o perfil, use `GET /companies/{cnpj}`. Sem resultados, responde 200 com a lista vazia.',
  })
  @ResponseSchema(SearchCompaniesResponseSchema, {
    description: 'Página de empresas encontradas',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  searchCompanies(
    @Query({ schema: SearchCompaniesQuerySchema }) query: SearchCompaniesQuery,
  ): Promise<SearchCompaniesResponse> {
    return this.searchCompaniesByNameUseCase.execute(query);
  }

  @Get(':cnpj')
  @ApiOperation({
    summary: 'Consulta o perfil cadastral de uma empresa pelo CNPJ',
    description:
      'Serve do cache quando há; do contrário, atualiza pela cadeia de provedores (BrasilAPI, OpenCNPJ, Minha Receita) e guarda o resultado. Com os provedores indisponíveis, serve o último cadastro guardado, se houver; sem ele, responde 503. Aceita CNPJ numérico e alfanumérico; os separadores `.` `-` são ignorados (a barra deve ser omitida, pois separa segmentos da URL).',
  })
  @ApiParam({
    name: 'cnpj',
    description: 'CNPJ da empresa, com 14 caracteres',
    example: '11222333000181',
  })
  @ResponseSchema(CompanyProfileResponseSchema, {
    description: 'Perfil cadastral da empresa',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.NOT_FOUND,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
    HttpStatus.SERVICE_UNAVAILABLE,
  )
  getCompanyProfile(
    @Param('cnpj') cnpj: string,
  ): Promise<CompanyProfileResponse> {
    return this.getCompanyProfileUseCase.execute(cnpj);
  }
}
