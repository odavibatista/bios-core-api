import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
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
  const config = { get: vi.fn() };
  let useCase: CheckHealthUseCase;

  beforeEach(async () => {
    databaseHealthProvider.isAvailable.mockResolvedValue(true);
    redisHealthProvider.isAvailable.mockResolvedValue(true);
    config.get.mockReturnValue('token-de-teste');

    const moduleRef = await Test.createTestingModule({
      providers: [
        CheckHealthUseCase,
        { provide: ConfigService, useValue: config },
        { provide: DatabaseHealthProvider, useValue: databaseHealthProvider },
        { provide: RedisHealthProvider, useValue: redisHealthProvider },
      ],
    }).compile();

    useCase = moduleRef.get(CheckHealthUseCase);
  });

  it('retorna uma resposta válida quando as dependências estão disponíveis', async () => {
    const response = await useCase.execute();

    expect(HealthCheckResponseSchema.parse(response)).toEqual(response);
    expect(response.checks).toEqual({
      database: 'up',
      redis: 'up',
      cgu_credentials: 'configured',
    });
  });
  it('informa credencial CGU ausente sem falhar a disponibilidade geral', async () => {
    config.get.mockReturnValue(undefined);
    expect((await useCase.execute()).checks).toEqual({
      database: 'up',
      redis: 'up',
      cgu_credentials: 'missing',
    });
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
