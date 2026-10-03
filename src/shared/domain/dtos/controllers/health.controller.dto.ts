import type { HealthCheckResponse } from '../requests/health-check.dto.js';

/**
 * Contrato do controller de health check.
 */
export interface HealthControllerInterface {
  check(): Promise<HealthCheckResponse>;
}
