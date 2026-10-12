import { Test } from '@nestjs/testing';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { dataSourceFactory } from '@test/factories/data-sources/data-source.factory.js';
import { buildTtlSeconds } from '@test/factories/shared/cache-entry.factory.js';
import { faker } from '@test/support/faker.js';
import { PrismaDataSourceRepository } from './prisma-data-source.repository.js';

describe('PrismaDataSourceRepository', () => {
  const findUnique =
    vi.fn<() => Promise<{ cache_ttl_seconds: number | null } | null>>();
  let repository: PrismaDataSourceRepository;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaDataSourceRepository,
        { provide: PrismaService, useValue: { dataSource: { findUnique } } },
      ],
    }).compile();

    repository = moduleRef.get(PrismaDataSourceRepository);
  });

  it('busca a janela de cache pelo slug da fonte', async () => {
    const source = dataSourceFactory.build({
      cache_ttl_seconds: buildTtlSeconds(),
    });
    findUnique.mockResolvedValue(source);

    await expect(repository.findCacheTtlSeconds(source.slug)).resolves.toBe(
      source.cache_ttl_seconds,
    );
    expect(findUnique).toHaveBeenCalledWith({
      where: { slug: source.slug },
      select: { cache_ttl_seconds: true },
    });
  });

  it('devolve null quando a fonte não tem janela configurada', async () => {
    findUnique.mockResolvedValue({ cache_ttl_seconds: null });

    await expect(
      repository.findCacheTtlSeconds(faker.string.alpha(8)),
    ).resolves.toBeNull();
  });

  it('devolve null quando a fonte não existe no catálogo', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      repository.findCacheTtlSeconds(faker.string.alpha(8)),
    ).resolves.toBeNull();
  });
});
