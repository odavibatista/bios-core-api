import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator.js';
import { SkipRateLimit } from '../decorators/skip-rate-limit.decorator.js';
import type { HealthControllerInterface } from '../../domain/dtos/controllers/health.controller.dto.js';
import {
  type HealthCheckResponse,
  HealthCheckResponseSchema,
} from '../../domain/dtos/requests/health-check.dto.js';
import { CheckHealthUseCase } from '../../infra/usecases/health/check-health.usecase.js';
import {
  ErrorResponses,
  ResponseSchema,
} from '../decorators/response-schema.decorator.js';

@ApiTags('Health')
// Fora do limite de requisições: é sondado de forma periódica pelo
// orquestrador, e um 429 aqui seria lido como indisponibilidade da API.
@SkipRateLimit()
// Pública: o orquestrador sonda sem credencial.
@Public()
@Controller('health')
export class HealthController implements HealthControllerInterface {
  constructor(private readonly checkHealthUseCase: CheckHealthUseCase) {}

  @Get()
  @ApiOperation({
    summary:
      'Verifica a API, o banco, o Redis e a configuração opcional da CGU',
  })
  @ResponseSchema(HealthCheckResponseSchema)
  @ErrorResponses(HttpStatus.SERVICE_UNAVAILABLE)
  check(): Promise<HealthCheckResponse> {
    return this.checkHealthUseCase.execute();
  }
}
