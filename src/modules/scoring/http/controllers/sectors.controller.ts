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
  type SectorEvolutionParams,
  SectorEvolutionParamsSchema,
  type SectorEvolutionQuery,
  SectorEvolutionQuerySchema,
  type SectorEvolutionResponse,
  SectorEvolutionResponseSchema,
} from '../../domain/dtos/requests/sector-evolution.dto.js';
import { GetSectorEvolutionUseCase } from '../../infra/usecases/get-sector-evolution.usecase.js';

/** Evolução setorial (UC10, RF30, `[P08]`): rota privada, para qualquer usuário com sessão. */
@ApiTags('Setores')
@ApiBearerAuth('jwt')
@Controller('sectors')
export class SectorsController {
  constructor(private readonly getEvolution: GetSectorEvolutionUseCase) {}

  @Get(':cnae/evolution')
  @ApiOperation({
    operationId: 'getSectorEvolution',
    summary: 'Evolução do índice médio de um ODS num setor',
    description:
      'Janelas mensais, da mais antiga à mais recente, com o índice médio, a confiança média e as contagens do setor (divisão CNAE: os 2 primeiros dígitos do CNAE informado). Sempre por setor, nunca por empresa (IA05); setor com poucas empresas tem as médias omitidas (nulas). Com menos de duas janelas, history_status é INSUFFICIENT. ODS que o BIOS não calcula responde 422 ODS_NOT_AVAILABLE, com os válidos.',
  })
  @ApiParam({
    name: 'cnae',
    description:
      'CNAE do setor: divisão (2 dígitos), grupo, classe ou subclasse, com ou sem máscara',
    example: '62',
  })
  @ResponseSchema(SectorEvolutionResponseSchema, {
    description: 'Evolução do setor no ODS',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  evolution(
    @Param({ schema: SectorEvolutionParamsSchema })
    params: SectorEvolutionParams,
    @Query({ schema: SectorEvolutionQuerySchema }) query: SectorEvolutionQuery,
  ): Promise<SectorEvolutionResponse> {
    return this.getEvolution.execute({
      cnaeDivision: params.cnae,
      odsNumber: query.ods,
    });
  }
}
