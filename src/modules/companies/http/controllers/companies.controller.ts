import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ErrorResponses,
  ResponseSchema,
} from '@shared/http/decorators/response-schema.decorator.js';
import type { CompaniesSearchControllerInterface } from '../../domain/dtos/controllers/companies.controller.dto.js';
import {
  type SearchCompaniesQuery,
  SearchCompaniesQuerySchema,
  type SearchCompaniesResponse,
  SearchCompaniesResponseSchema,
} from '../../domain/dtos/requests/search-companies.dto.js';
import { SearchCompaniesByNameUseCase } from '../../infra/usecases/search-companies-by-name.usecase.js';

// Privado, como toda rota sem `@Public()`: consultar empresas exige sessão (RF02).
@ApiTags('Empresas')
@ApiBearerAuth('jwt')
@Controller('companies')
export class CompaniesController implements CompaniesSearchControllerInterface {
  constructor(
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
}
