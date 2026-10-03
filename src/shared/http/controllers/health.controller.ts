import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
@Controller('health')
export class HealthController implements HealthControllerInterface {
  constructor(private readonly checkHealthUseCase: CheckHealthUseCase) {}

  @Get()
  @ApiOperation({
    summary: 'Verifica a disponibilidade da API e do banco de dados',
  })
  @ResponseSchema(HealthCheckResponseSchema)
  @ErrorResponses(HttpStatus.SERVICE_UNAVAILABLE)
  check(): Promise<HealthCheckResponse> {
    return this.checkHealthUseCase.execute();
  }
}
