import { Controller, Get, HttpStatus, Param } from '@nestjs/common';
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
import type { ScoreExplanationControllerInterface } from '../../domain/dtos/controllers/score-explanation.controller.dto.js';
import {
  ScoreExplanationRequestSchema,
  ScoreExplanationResponseSchema,
  type ScoreExplanationRequest,
  type ScoreExplanationResponse,
} from '../../domain/dtos/requests/score-explanation.dto.js';
import { GetScoreExplanationUseCase } from '../../infra/usecases/get-score-explanation.usecase.js';

@ApiTags('Índices por ODS')
@ApiBearerAuth('jwt')
@Controller('companies')
export class ScoreExplanationController implements ScoreExplanationControllerInterface {
  constructor(private readonly explanation: GetScoreExplanationUseCase) {}

  @Get(':cnpj/scores/:odsNumber/explanation')
  @ApiOperation({
    operationId: 'getScoreExplanation',
    summary: 'Explica as contribuições do índice de um ODS',
    description:
      'Lê o índice já calculado, sem coletar ou recalcular. Lista as evidências que contribuíram, com fonte, estado no cálculo, estado atual, peso, sinal e pontos. A soma dos pontos reproduz o índice. Índice nulo retorna UNAVAILABLE com lista vazia. Sem score responde 404; se uma evidência contribuinte deixou de ser auditável, responde 409. O índice não é um veredito de sustentabilidade.',
  })
  @ApiParam({
    name: 'cnpj',
    description: 'CNPJ válido da empresa',
    example: '11222333000181',
  })
  @ApiParam({ name: 'odsNumber', description: 'Número do ODS', example: 15 })
  @ResponseSchema(ScoreExplanationResponseSchema, {
    description: 'Índice, confiança e contribuições auditáveis do ODS',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
    HttpStatus.INTERNAL_SERVER_ERROR,
  )
  getExplanation(
    @Param({ schema: ScoreExplanationRequestSchema })
    params: ScoreExplanationRequest,
  ): Promise<ScoreExplanationResponse> {
    return this.explanation.execute(params);
  }
}
