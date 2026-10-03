import { Test } from '@nestjs/testing';
import { HealthCheckResponseSchema } from '../../../domain/dtos/requests/health-check.dto.js';
import { DependencyUnavailableException } from '../../../domain/errors/dependency-unavailable.exception.js';
import { DatabaseHealthProvider } from '../../../domain/providers/database-health.provider.js';
import { CheckHealthUseCase } from './check-health.usecase.js';

describe('CheckHealthUseCase', () => {
  const databaseHealthProvider = {
    isAvailable: vi.fn<() => Promise<boolean>>(),
  };
  let useCase: CheckHealthUseCase;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CheckHealthUseCase,
        { provide: DatabaseHealthProvider, useValue: databaseHealthProvider },
      ],
    }).compile();

    useCase = moduleRef.get(CheckHealthUseCase);
  });

  it('retorna uma resposta válida quando o banco está disponível', async () => {
    databaseHealthProvider.isAvailable.mockResolvedValue(true);

    const response = await useCase.execute();

    expect(HealthCheckResponseSchema.parse(response)).toEqual(response);
    expect(response.checks.database).toBe('up');
  });

  it('lança DependencyUnavailableException quando o banco não responde', async () => {
    databaseHealthProvider.isAvailable.mockResolvedValue(false);

    await expect(useCase.execute()).rejects.toBeInstanceOf(
      DependencyUnavailableException,
    );
  });
});
