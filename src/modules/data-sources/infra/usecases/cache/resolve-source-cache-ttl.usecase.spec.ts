import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Duration } from '@shared/domain/value-objects/duration.js';
import { buildTtlSeconds } from '@test/factories/shared/cache-entry.factory.js';
import { faker } from '@test/support/faker.js';
import { DataSourceRepository } from '../../../domain/dtos/repositories/data-source.repository.js';
import { ResolveSourceCacheTtlUseCase } from './resolve-source-cache-ttl.usecase.js';

/** Reserva configurada no ambiente das suítes. */
const FALLBACK = Duration.parse('7d');

describe('ResolveSourceCacheTtlUseCase', () => {
  const dataSourceRepository = {
    findCacheTtlSeconds: vi.fn<() => Promise<number | null>>(),
  };
  let useCase: ResolveSourceCacheTtlUseCase;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ResolveSourceCacheTtlUseCase,
        { provide: DataSourceRepository, useValue: dataSourceRepository },
        { provide: ConfigService, useValue: { get: () => FALLBACK } },
      ],
    }).compile();

    useCase = moduleRef.get(ResolveSourceCacheTtlUseCase);
  });

  it('usa a janela configurada na fonte', async () => {
    const slug = faker.string.alpha({ length: 10, casing: 'upper' });
    const configured = buildTtlSeconds();
    dataSourceRepository.findCacheTtlSeconds.mockResolvedValue(configured);

    await expect(useCase.execute(slug)).resolves.toBe(configured);
    expect(dataSourceRepository.findCacheTtlSeconds).toHaveBeenCalledWith(slug);
  });

  it('consulta o catálogo a cada chamada, para o ajuste valer de imediato', async () => {
    const [first, second] = [buildTtlSeconds(), buildTtlSeconds()];
    dataSourceRepository.findCacheTtlSeconds
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const slug = faker.string.alpha(8);

    await expect(useCase.execute(slug)).resolves.toBe(first);
    await expect(useCase.execute(slug)).resolves.toBe(second);
  });

  it('recorre à reserva quando a fonte não tem janela configurada', async () => {
    dataSourceRepository.findCacheTtlSeconds.mockResolvedValue(null);

    await expect(useCase.execute(faker.string.alpha(8))).resolves.toBe(
      FALLBACK.toSeconds(),
    );
  });

  it('recorre à reserva quando o catálogo não pode ser consultado', async () => {
    dataSourceRepository.findCacheTtlSeconds.mockRejectedValue(
      new Error(faker.lorem.sentence()),
    );

    // Sem cache, toda consulta voltaria à fonte externa: a reserva é o menor mal.
    await expect(useCase.execute(faker.string.alpha(8))).resolves.toBe(
      FALLBACK.toSeconds(),
    );
  });
});
