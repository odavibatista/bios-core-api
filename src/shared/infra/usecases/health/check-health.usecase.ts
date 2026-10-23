import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../config/environment.config.js';
import type { HealthCheckResponse } from '../../../domain/dtos/requests/health-check.dto.js';
import { DependencyUnavailableException } from '../../../domain/errors/dependency-unavailable.exception.js';
import { UseCase } from '../../../domain/protocols/use-case.protocol.js';
import { DatabaseHealthProvider } from '../../../domain/providers/database-health.provider.js';
import { RedisHealthProvider } from '../../../domain/providers/redis-health.provider.js';

/**
 * Verifica a disponibilidade da API e de suas dependências.
 *
 * As dependências são consultadas em paralelo, e a resposta nomeia a primeira
 * indisponível na ordem em que são declaradas: quem lê o erro precisa saber
 * qual delas derrubou a verificação.
 *
 * @throws {DependencyUnavailableException} quando uma dependência não responde.
 */
@Injectable()
export class CheckHealthUseCase extends UseCase<void, HealthCheckResponse> {
  constructor(
    private readonly config: ConfigService<Environment, true>,
    private readonly databaseHealthProvider: DatabaseHealthProvider,
    private readonly redisHealthProvider: RedisHealthProvider,
  ) {
    super();
  }

  override async execute(): Promise<HealthCheckResponse> {
    const dependencies = {
      database: this.databaseHealthProvider,
      redis: this.redisHealthProvider,
    };
    const availability = await Promise.all(
      Object.values(dependencies).map((provider) => provider.isAvailable()),
    );
    const unavailable = Object.keys(dependencies).find(
      (_name, position) => !availability[position],
    );

    if (unavailable) {
      throw new DependencyUnavailableException(unavailable);
    }

    return {
      status: 'ok',
      uptime_seconds: Math.floor(process.uptime()),
      checks: {
        database: 'up',
        redis: 'up',
        cgu_credentials: this.config.get('CGU_API_KEY', { infer: true })
          ? 'configured'
          : 'missing',
      },
      timestamp: new Date().toISOString(),
    };
  }
}
