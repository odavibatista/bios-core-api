import { Controller, Get, HttpStatus, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ThrottlerName } from '@shared/config/throttler.config.js';
import {
  ErrorResponses,
  ResponseSchema,
} from '@shared/http/decorators/response-schema.decorator.js';
import { RouteRateLimit } from '@shared/http/decorators/route-rate-limit.decorator.js';
import {
  type IbgeCityListResponse,
  IbgeCityListResponseSchema,
  type IbgeStateListResponse,
  IbgeStateListResponseSchema,
  type ListCitiesQuery,
  ListCitiesQuerySchema,
  type PostalAddress,
  PostalAddressSchema,
  type PostalCodeParam,
  PostalCodeParamSchema,
  type StateParam,
  StateParamSchema,
} from '../../domain/dtos/requests/location.dto.js';
import { ListCitiesUseCase } from '../../infra/usecases/list-cities.usecase.js';
import { ListStatesUseCase } from '../../infra/usecases/list-states.usecase.js';
import { LookupPostalCodeUseCase } from '../../infra/usecases/lookup-postal-code.usecase.js';

/** Catálogo de UFs e municípios do IBGE e consulta de CEP, para o endereço (RF38, RF39). */
@ApiTags('Localidades')
@ApiBearerAuth('jwt')
@Controller('locations')
export class LocationsController {
  constructor(
    private readonly listStatesUseCase: ListStatesUseCase,
    private readonly listCitiesUseCase: ListCitiesUseCase,
    private readonly lookupPostalCodeUseCase: LookupPostalCodeUseCase,
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

  @Get('postal-codes/:cep')
  // Cada CEP novo vira uma chamada a um serviço de terceiros: limite próprio.
  @RouteRateLimit(ThrottlerName.POSTAL_CODE)
  @ApiOperation({
    operationId: 'lookupPostalCode',
    summary: 'Consulta o endereço de um CEP',
    description:
      'Devolve logradouro, bairro, município e UF do CEP, nunca número nem complemento. Consulta o ViaCEP enviando só o CEP, com prazo de 3 segundos, e guarda a resposta em cache. Em 404 ou 503, a pessoa preenche o endereço à mão: a consulta nunca impede gravar a conta. CEP geral de município vem sem logradouro nem bairro. Limite próprio por IP (padrão: 20 consultas por minuto, `THROTTLE_POSTAL_CODE_LIMIT`), no lugar do limite global.',
  })
  @ApiParam({ name: 'cep', description: 'CEP, com ou sem hífen' })
  @ResponseSchema(PostalAddressSchema, { description: 'Endereço do CEP' })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.NOT_FOUND,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
    HttpStatus.SERVICE_UNAVAILABLE,
  )
  lookupPostalCode(
    @Param({ schema: PostalCodeParamSchema }) { cep }: PostalCodeParam,
  ): Promise<PostalAddress> {
    return this.lookupPostalCodeUseCase.execute(cep);
  }
}
