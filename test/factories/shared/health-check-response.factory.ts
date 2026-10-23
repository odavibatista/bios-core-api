import type { HealthCheckResponse } from '@shared/domain/dtos/requests/health-check.dto.js';
import { faker } from '../../support/faker.js';
import { defineFactory } from '../factory.js';

/** Resposta do health check com a API e suas dependências disponíveis. */
export const healthCheckResponseFactory = defineFactory<HealthCheckResponse>(
  () => ({
    status: 'ok',
    uptime_seconds: faker.number.int({ max: 30 * 86_400 }),
    checks: { database: 'up', redis: 'up', cgu_credentials: 'configured' },
    timestamp: faker.date.recent().toISOString(),
  }),
);
