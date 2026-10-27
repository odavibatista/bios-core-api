import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ErrorResponses,
  ResponseSchema,
} from '@shared/http/decorators/response-schema.decorator.js';
import type { OdsControllerInterface } from '../../domain/dtos/controllers/ods.controller.dto.js';
import {
  OdsListResponseSchema,
  type OdsListResponse,
} from '../../domain/dtos/requests/ods-catalog.dto.js';
import { ListOdsUseCase } from '../../infra/usecases/list-ods.usecase.js';

// Privado, como toda rota sem `@Public()`: o seletor serve às telas autenticadas (RF02).
@ApiTags('Índices por ODS')
@ApiBearerAuth('jwt')
@Controller('ods')
export class OdsController implements OdsControllerInterface {
  constructor(private readonly listOdsUseCase: ListOdsUseCase) {}

  @Get()
  @ApiOperation({
    operationId: 'listOds',
    summary: 'Lista os ODS que o BIOS calcula',
    description:
      'Devolve os ODS ativos no cálculo de índices (hoje o 13 e o 15), com número, título e descrição, em ordem crescente. É o conjunto aceito em `ods` na pesquisa (`GET /companies`) e na exportação: qualquer outro número responde 422 com a lista dos válidos. ODS desativado não aparece.',
  })
  @ResponseSchema(OdsListResponseSchema, {
    description: 'ODS ativos no cálculo de índices',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.TOO_MANY_REQUESTS,
    HttpStatus.INTERNAL_SERVER_ERROR,
  )
  listOds(): Promise<OdsListResponse> {
    return this.listOdsUseCase.execute();
  }
}
