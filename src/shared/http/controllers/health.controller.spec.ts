import { Test } from '@nestjs/testing';
import { healthCheckResponseFactory } from '@test/factories/shared/health-check-response.factory.js';
import { CheckHealthUseCase } from '../../infra/usecases/health/check-health.usecase.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('delega a verificação ao caso de uso', async () => {
    const health = healthCheckResponseFactory.build();
    const execute = vi.fn().mockResolvedValue(health);

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: CheckHealthUseCase, useValue: { execute } }],
    }).compile();

    await expect(moduleRef.get(HealthController).check()).resolves.toBe(health);
    expect(execute).toHaveBeenCalledOnce();
  });
});
