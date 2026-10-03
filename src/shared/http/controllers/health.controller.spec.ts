import { Test } from '@nestjs/testing';
import type { HealthCheckResponse } from '../../domain/dtos/requests/health-check.dto.js';
import { CheckHealthUseCase } from '../../infra/usecases/health/check-health.usecase.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('delega a verificação ao caso de uso', async () => {
    const health: HealthCheckResponse = {
      status: 'ok',
      uptime_seconds: 42,
      checks: { database: 'up' },
      timestamp: '2026-10-03T12:00:00.000Z',
    };
    const execute = vi.fn().mockResolvedValue(health);

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: CheckHealthUseCase, useValue: { execute } }],
    }).compile();

    await expect(moduleRef.get(HealthController).check()).resolves.toBe(health);
    expect(execute).toHaveBeenCalledOnce();
  });
});
