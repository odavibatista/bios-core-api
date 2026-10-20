import { Test } from '@nestjs/testing';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { dataSourceFactory } from '@test/factories/data-sources/data-source.factory.js';
import { buildTtlSeconds } from '@test/factories/shared/cache-entry.factory.js';
import { faker } from '@test/support/faker.js';
import { PrismaDataSourceRepository } from './prisma-data-source.repository.js';

describe('PrismaDataSourceRepository', () => {
  const findUnique = vi.fn();
  const findMany = vi.fn();
  let repository: PrismaDataSourceRepository;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaDataSourceRepository,
        {
          provide: PrismaService,
          useValue: { dataSource: { findUnique, findMany } },
        },
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

  describe('findEvidenceSource', () => {
    const odsId = faker.database.mongodbObjectId();
    const sourceId = faker.database.mongodbObjectId();
    const evidenceDocument = {
      id_data_source: sourceId,
      slug: 'IBAMA',
      role: 'EVIDENCE',
      evidence_category: 'INFRACAO_AMBIENTAL',
      ods_id: odsId,
      ods: { ods_number: 15 },
    };

    it('busca a categoria e o ODS da fonte pelo slug', async () => {
      findUnique.mockResolvedValue(null);

      await repository.findEvidenceSource('IBAMA');

      expect(findUnique).toHaveBeenCalledWith({
        where: { slug: 'IBAMA' },
        select: {
          id_data_source: true,
          slug: true,
          role: true,
          evidence_category: true,
          ods_id: true,
          ods: { select: { ods_number: true } },
        },
      });
    });

    it('converte o documento para a configuração do domínio', async () => {
      findUnique.mockResolvedValue(evidenceDocument);

      await expect(repository.findEvidenceSource('IBAMA')).resolves.toEqual({
        id: sourceId,
        slug: 'IBAMA',
        category: 'INFRACAO_AMBIENTAL',
        odsId,
        odsNumber: 15,
      });
    });

    it('devolve null quando a fonte não existe', async () => {
      findUnique.mockResolvedValue(null);

      await expect(repository.findEvidenceSource('NADA')).resolves.toBeNull();
    });

    it.each([
      ['não é de evidências', { role: 'CADASTRAL' }],
      ['está sem categoria', { evidence_category: null }],
      ['está sem ODS (id)', { ods_id: null }],
      ['está sem ODS (documento)', { ods: null }],
    ])('devolve null quando a fonte %s', async (_caso, override) => {
      findUnique.mockResolvedValue({ ...evidenceDocument, ...override });

      await expect(repository.findEvidenceSource('IBAMA')).resolves.toBeNull();
    });
  });

  describe('findCadastralChain', () => {
    it('busca só as fontes cadastrais habilitadas e com prioridade, da primeira à última', async () => {
      findMany.mockResolvedValue([]);

      await repository.findCadastralChain();

      expect(findMany).toHaveBeenCalledWith({
        where: {
          role: 'CADASTRAL',
          is_enabled: true,
          fallback_priority: { not: null },
        },
        orderBy: { fallback_priority: 'asc' },
        select: { slug: true },
      });
    });

    it('devolve os slugs na ordem recebida', async () => {
      findMany.mockResolvedValue([
        { slug: 'BRASIL_API' },
        { slug: 'OPEN_CNPJ' },
        { slug: 'MINHA_RECEITA' },
      ]);

      await expect(repository.findCadastralChain()).resolves.toEqual([
        'BRASIL_API',
        'OPEN_CNPJ',
        'MINHA_RECEITA',
      ]);
    });

    it('devolve lista vazia quando não há fonte cadastral habilitada', async () => {
      findMany.mockResolvedValue([]);

      await expect(repository.findCadastralChain()).resolves.toEqual([]);
    });
  });
});
