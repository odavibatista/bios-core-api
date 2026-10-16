import { Test } from '@nestjs/testing';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { dataSourceFactory } from '@test/factories/data-sources/data-source.factory.js';
import { buildTtlSeconds } from '@test/factories/shared/cache-entry.factory.js';
import { faker } from '@test/support/faker.js';
import { PrismaDataSourceRepository } from './prisma-data-source.repository.js';

describe('PrismaDataSourceRepository', () => {
  const findUnique = vi.fn();
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

  describe('findRequestConfig', () => {
    it('busca só o que as chamadas respeitam, pelo slug', async () => {
      findUnique.mockResolvedValue(null);

      await repository.findRequestConfig('BRASIL_API');

      expect(findUnique).toHaveBeenCalledWith({
        where: { slug: 'BRASIL_API' },
        select: {
          id_data_source: true,
          slug: true,
          base_url: true,
          is_enabled: true,
          rate_limit_per_minute: true,
          request_timeout_ms: true,
        },
      });
    });

    it('converte o documento para a configuração do domínio', async () => {
      const id = faker.database.mongodbObjectId();
      findUnique.mockResolvedValue({
        id_data_source: id,
        slug: 'CGU_CEIS',
        base_url: 'https://api.portaldatransparencia.gov.br/api-de-dados/ceis',
        is_enabled: true,
        rate_limit_per_minute: 90,
        request_timeout_ms: 5_000,
      });

      await expect(repository.findRequestConfig('CGU_CEIS')).resolves.toEqual({
        id,
        slug: 'CGU_CEIS',
        baseUrl: 'https://api.portaldatransparencia.gov.br/api-de-dados/ceis',
        isEnabled: true,
        rateLimitPerMinute: 90,
        requestTimeoutMs: 5_000,
      });
    });

    it('mantém null nos limites que a fonte não declara', async () => {
      findUnique.mockResolvedValue({
        id_data_source: faker.database.mongodbObjectId(),
        slug: 'IBAMA',
        base_url: 'https://dadosabertos.ibama.gov.br',
        is_enabled: false,
        rate_limit_per_minute: null,
        request_timeout_ms: null,
      });

      await expect(
        repository.findRequestConfig('IBAMA'),
      ).resolves.toMatchObject({
        isEnabled: false,
        rateLimitPerMinute: null,
        requestTimeoutMs: null,
      });
    });

    it('devolve null quando a fonte não existe', async () => {
      findUnique.mockResolvedValue(null);

      await expect(repository.findRequestConfig('NADA')).resolves.toBeNull();
    });
  });
});
