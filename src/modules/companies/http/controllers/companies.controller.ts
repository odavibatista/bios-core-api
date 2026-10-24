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
import { SearchCompaniesUseCase } from '../../infra/usecases/search-companies.usecase.js';

// Privado, como toda rota sem `@Public()`: consultar empresas exige sessão (RF02).
@ApiTags('Empresas')
@ApiBearerAuth('jwt')
@Controller('companies')
export class CompaniesController implements CompaniesSearchControllerInterface {
  constructor(
    private readonly searchCompaniesUseCase: SearchCompaniesUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Pesquisa e ordena empresas por nome, UF, município, CNAE e ODS',
    description:
      'Procura entre as empresas já consultadas pelo BIOS (nenhuma fonte cadastral oferece busca): devolve as que atendem a todos os critérios informados, e ao menos um é obrigatório. `name`: uma palavra começando por cada palavra digitada, na razão social ou no nome fantasia, em qualquer ordem; quem começa pela frase digitada vem primeiro. `uf`: sigla. `city`: nome inteiro do município, sem distinguir acento, caixa ou pontuação. `cnae`: código de 2 a 7 dígitos, casado como prefixo com o CNAE principal ou algum secundário. `ods`: seleciona um ODS e devolve, em cada empresa, o índice e a confiança dele (`ods_score`); `min_score` e `min_confidence` filtram por esse ODS e exigem `ods`, e empresa sem índice calculado no ODS não passa por mínimo algum. `order` (`asc` ou `desc`, exige `ods`) ordena pelo índice do ODS selecionado: empresa sem índice calculado vem sempre ao fim, nos dois sentidos, e entre índices iguais a de maior confiança vem primeiro. Sem ordem pedida, a lista vem pela proximidade com o nome digitado e, depois, por razão social. Para abrir o perfil, use `GET /companies/{cnpj}`. Sem resultados, responde 200 com a lista vazia.',
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
    return this.searchCompaniesUseCase.execute(query);
  }
}
