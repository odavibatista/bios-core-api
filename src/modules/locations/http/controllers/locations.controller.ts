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
import {
  type IbgeCityListResponse,
  IbgeCityListResponseSchema,
  type IbgeStateListResponse,
  IbgeStateListResponseSchema,
  type ListCitiesQuery,
  ListCitiesQuerySchema,
  type StateParam,
  StateParamSchema,
} from '../../domain/dtos/requests/location.dto.js';
import { ListCitiesUseCase } from '../../infra/usecases/list-cities.usecase.js';
import { ListStatesUseCase } from '../../infra/usecases/list-states.usecase.js';

/** Catálogo de UFs e municípios do IBGE, para os seletores da tela (RF38). */
@ApiTags('Localidades')
@ApiBearerAuth('jwt')
@Controller('locations')
export class LocationsController {
  constructor(
    private readonly listStatesUseCase: ListStatesUseCase,
    private readonly listCitiesUseCase: ListCitiesUseCase,
  ) {}

  @Get('states')
  @ApiOperation({
    operationId: 'listStates',
    summary: 'Lista as unidades da federação',
    description:
      'As 27 UFs, com o código do IBGE, em ordem alfabética de nome. Vem do catálogo em disco: nenhuma consulta vai ao IBGE.',
  })
  @ResponseSchema(IbgeStateListResponseSchema, {
    description: 'Unidades da federação',
  })
  @ErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.TOO_MANY_REQUESTS)
  listStates(): Promise<IbgeStateListResponse> {
    return this.listStatesUseCase.execute();
  }

  @Get('states/:uf/cities')
  @ApiOperation({
    operationId: 'listCities',
    summary: 'Lista os municípios de uma UF',
    description:
      'Só os municípios da UF informada. `search` filtra pelo trecho digitado, sem distinguir acento, caixa ou pontuação, e também alcança grafias usadas por outras fontes (`parati` encontra Paraty). Quem começa pelo trecho vem primeiro. Sem `search`, a lista vem em ordem alfabética.',
  })
  @ApiParam({ name: 'uf', description: 'Sigla da UF' })
  @ResponseSchema(IbgeCityListResponseSchema, {
    description: 'Página de municípios',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  listCities(
    @Param({ schema: StateParamSchema }) { uf }: StateParam,
    @Query({ schema: ListCitiesQuerySchema }) query: ListCitiesQuery,
  ): Promise<IbgeCityListResponse> {
    return this.listCitiesUseCase.execute({ uf, ...query });
  }
}
