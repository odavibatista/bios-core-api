import { Injectable } from '@nestjs/common';
import type { HealthCheckResponse } from '../../../domain/dtos/requests/health-check.dto.js';
import { DependencyUnavailableException } from '../../../domain/errors/dependency-unavailable.exception.js';
import { UseCase } from '../../../domain/protocols/use-case.protocol.js';
import { DatabaseHealthProvider } from '../../../domain/providers/database-health.provider.js';

/**
 * Verifica a disponibilidade da API e de suas dependências.
 *
 * @throws {DependencyUnavailableException} quando o banco de dados não responde.
 */
@Injectable()
export class CheckHealthUseCase extends UseCase<void, HealthCheckResponse> {
  constructor(private readonly databaseHealthProvider: DatabaseHealthProvider) {
    super();
  }

  override async execute(): Promise<HealthCheckResponse> {
    if (!(await this.databaseHealthProvider.isAvailable())) {
      throw new DependencyUnavailableException('database');
    }

    return {
      status: 'ok',
      uptime_seconds: Math.floor(process.uptime()),
      checks: { database: 'up' },
      timestamp: new Date().toISOString(),
    };
  }
}
