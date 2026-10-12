import { Test } from '@nestjs/testing';
import { HealthCheckResponseSchema } from '../../../domain/dtos/requests/health-check.dto.js';
import { DependencyUnavailableException } from '../../../domain/errors/dependency-unavailable.exception.js';
import { DatabaseHealthProvider } from '../../../domain/providers/database-health.provider.js';
import { RedisHealthProvider } from '../../../domain/providers/redis-health.provider.js';
import { CheckHealthUseCase } from './check-health.usecase.js';

describe('CheckHealthUseCase', () => {
  const databaseHealthProvider = {
    isAvailable: vi.fn<() => Promise<boolean>>(),
  };
  const redisHealthProvider = {
    isAvailable: vi.fn<() => Promise<boolean>>(),
  };
  let useCase: CheckHealthUseCase;

  beforeEach(async () => {
    databaseHealthProvider.isAvailable.mockResolvedValue(true);
    redisHealthProvider.isAvailable.mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({
      providers: [
        CheckHealthUseCase,
        { provide: DatabaseHealthProvider, useValue: databaseHealthProvider },
        { provide: RedisHealthProvider, useValue: redisHealthProvider },
      ],
    }).compile();

    useCase = moduleRef.get(CheckHealthUseCase);
  });

  it('retorna uma resposta válida quando as dependências estão disponíveis', async () => {
    const response = await useCase.execute();

    expect(HealthCheckResponseSchema.parse(response)).toEqual(response);
    expect(response.checks).toEqual({ database: 'up', redis: 'up' });
  });

  it.each([
    ['database', databaseHealthProvider],
    ['redis', redisHealthProvider],
  ])(
    'lança DependencyUnavailableException nomeando %s',
    async (dependency, provider) => {
      provider.isAvailable.mockResolvedValue(false);

      const attempt = useCase.execute();

      await expect(attempt).rejects.toBeInstanceOf(
        DependencyUnavailableException,
      );
      await expect(attempt).rejects.toMatchObject({ details: { dependency } });
    },
  );

  it('consulta as dependências em paralelo', async () => {
    await useCase.execute();

    expect(databaseHealthProvider.isAvailable).toHaveBeenCalled();
    expect(redisHealthProvider.isAvailable).toHaveBeenCalled();
  });
});
