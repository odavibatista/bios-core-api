import { Controller, Get, HttpStatus, Param } from '@nestjs/common';
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
  type CompanyIndexEvolution,
  CompanyIndexEvolutionResponseSchema,
} from '../../domain/dtos/requests/company-index-evolution.dto.js';
import { GetCompanyIndexEvolutionUseCase } from '../../infra/usecases/get-company-index-evolution.usecase.js';

/** Evolução do índice no perfil da empresa (UC07, RF36). Privada, e fora da API por chave. */
@ApiTags('Índices por ODS')
@ApiBearerAuth('jwt')
@Controller('companies')
export class CompanyIndexEvolutionController {
  constructor(private readonly evolution: GetCompanyIndexEvolutionUseCase) {}

  @Get(':cnpj/index-evolution')
  @RouteRateLimit(ThrottlerName.COMPANY_PROFILE)
  @ApiOperation({
    operationId: 'getCompanyIndexEvolution',
    summary: 'Mostra como o índice da empresa chegou ao valor atual',
    description:
      'Reaplica as regras vigentes às evidências que compõem o índice atual e devolve, por ODS, os degraus em ordem cronológica, cada um com a evidência que o causou. A série é reconstruída na leitura e não é gravada: registros que a fonte retirou não entram. Não traz variação nem comparação com outras empresas. `status` diz por que a evolução aparece ou não: `INDIVIDUAL_ENTREPRENEUR` (empresário individual, sem série), `LEGAL_NATURE_PENDING` (natureza jurídica ainda desconhecida), `SHORT_HISTORY` (menos de dois anos de evidências ou de dois degraus), `NO_DATED_EVIDENCE` e `NOT_REPRODUCIBLE` (a série não chegaria ao índice gravado).',
  })
  @ApiParam({
    name: 'cnpj',
    description: 'CNPJ válido da empresa',
    example: '11222333000181',
  })
  @ResponseSchema(CompanyIndexEvolutionResponseSchema, {
    description: 'Evolução do índice, por ODS',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.NOT_FOUND,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  getEvolution(@Param('cnpj') cnpj: string): Promise<CompanyIndexEvolution> {
    return this.evolution.execute(cnpj);
  }
}
