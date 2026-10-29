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
  type SectorListResponse,
  SectorListResponseSchema,
} from '../../domain/dtos/requests/sector-evolution.dto.js';
import { GetSectorEvolutionUseCase } from '../../infra/usecases/get-sector-evolution.usecase.js';
import { ListSectorsUseCase } from '../../infra/usecases/list-sectors.usecase.js';

/** Evolução setorial (UC10, RF30, `[P08]`): rotas privadas, para qualquer usuário com sessão. */
@ApiTags('Setores')
@ApiBearerAuth('jwt')
@Controller('sectors')
export class SectorsController {
  constructor(
    private readonly listSectorsUseCase: ListSectorsUseCase,
    private readonly getEvolution: GetSectorEvolutionUseCase,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'listSectors',
    summary: 'Lista os setores com evolução registrada',
    description:
      'Divisões CNAE (2 dígitos) com ao menos uma janela de agregados, com a descrição oficial do IBGE, em ordem crescente. É o seletor de setor da evolução setorial; só setores, nunca empresas (IA05).',
  })
  @ResponseSchema(SectorListResponseSchema, {
    description: 'Setores com evolução registrada',
  })
  @ErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.TOO_MANY_REQUESTS)
  listSectors(): Promise<SectorListResponse> {
    return this.listSectorsUseCase.execute();
  }

  @Get(':cnae/evolution')
  @ApiOperation({
    operationId: 'getSectorEvolution',
    summary: 'Evolução do índice médio de um ODS num setor',
    description:
      'Janelas mensais, da mais antiga à mais recente, com o índice médio, a confiança média e as contagens do setor (divisão CNAE: os 2 primeiros dígitos do CNAE informado, que precisa existir na CNAE 2.3). Sempre por setor, nunca por empresa (IA05); setor com poucas empresas tem as médias omitidas (nulas). Com menos de duas janelas, history_status é INSUFFICIENT. ODS que o BIOS não calcula responde 422 ODS_NOT_AVAILABLE, com os válidos.',
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
