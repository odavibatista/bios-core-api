import { Test } from '@nestjs/testing';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { faker } from '@test/support/faker.js';
import type { SearchCompaniesInput } from '../../../domain/dtos/repositories/company-profile.repository.js';
import { CompanyProfileResponseSchema } from '../../../domain/dtos/requests/company-profile.dto.js';
import {
  buildScoredCnpjsPipeline,
  buildScoredCountPipeline,
  buildScoredFilteredPipeline,
  buildScoredPagePipeline,
} from './company-scored-search.pipeline.js';
import {
  buildCompanyCountPipeline,
  buildCompanySearchPipeline,
} from './company-search.pipeline.js';
import { PrismaCompanyProfileRepository } from './prisma-company-profile.repository.js';

describe('PrismaCompanyProfileRepository', () => {
  const findUnique = vi.fn();
  const upsert = vi.fn();
  const aggregateRaw = vi.fn();
  const scoreAggregateRaw = vi.fn();
  const findSourceOrThrow = vi.fn();
  let repository: PrismaCompanyProfileRepository;

  function buildDocument(overrides: Record<string, unknown> = {}) {
    return {
      id_company_profile: faker.database.mongodbObjectId(),
      cnpj: buildCnpj(),
      legal_name: faker.company.name(),
      trade_name: faker.company.name(),
      registration_status: 'ATIVA',
      company_size: 'DEMAIS',
      address: {
        street: faker.location.street(),
        number: '100',
        complement: 'Sala 2',
        neighborhood: faker.location.county(),
        city: faker.location.city(),
        city_ibge_code: '3550308',
        uf: 'SP',
        zipcode: '01310100',
      },
      main_cnae: {
        code: '6201501',
        description: 'Desenvolvimento de software',
      },
      secondary_cnaes: [
        { code: '6202300', description: 'Consultoria em TI' },
        { code: '6311900', description: 'Tratamento de dados' },
      ],
      cadastral_source_id: faker.database.mongodbObjectId(),
      content_hash: faker.string.hexadecimal({ length: 64, prefix: '' }),
      previous_content_hash: faker.string.hexadecimal({
        length: 64,
        prefix: '',
      }),
      refreshed_at: faker.date.recent(),
      created_at: faker.date.past(),
      updated_at: faker.date.recent(),
      cadastral_source: { slug: 'OPEN_CNPJ' },
      ...overrides,
    };
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaCompanyProfileRepository,
        {
          provide: PrismaService,
          useValue: {
            companyProfile: { findUnique, upsert, aggregateRaw },
            companyOdsScore: { aggregateRaw: scoreAggregateRaw },
            dataSource: { findUniqueOrThrow: findSourceOrThrow },
          },
        },
      ],
    }).compile();

    repository = moduleRef.get(PrismaCompanyProfileRepository);
  });

  it('procura pelo CNPJ, trazendo o slug da fonte que respondeu', async () => {
    findUnique.mockResolvedValue(null);
    const cnpj = buildCnpj();

    await repository.findByCnpj(cnpj);

    expect(findUnique).toHaveBeenCalledWith({
      where: { cnpj },
      include: { cadastral_source: { select: { slug: true } } },
    });
  });

  it('devolve null quando não há perfil', async () => {
    findUnique.mockResolvedValue(null);

    await expect(repository.findByCnpj(buildCnpj())).resolves.toBeNull();
  });

  it('devolve o perfil no formato da API, com a fonte e a data da atualização', async () => {
    const document = buildDocument();
    findUnique.mockResolvedValue(document);

    const stored = await repository.findByCnpj(document.cnpj);

    expect(stored).toMatchObject({
      cadastralSourceSlug: 'OPEN_CNPJ',
      refreshedAt: document.refreshed_at,
      contentHash: document.content_hash,
      previousContentHash: document.previous_content_hash,
    });
    expect(stored?.profile).toEqual({
      cnpj: document.cnpj,
      legal_name: document.legal_name,
      trade_name: document.trade_name,
      registration_status: 'ATIVA',
      company_size: 'DEMAIS',
      address: document.address,
      main_cnae: document.main_cnae,
      secondary_cnaes: document.secondary_cnaes,
      refreshed_at: document.refreshed_at.toISOString(),
    });
  });

  it('o perfil devolvido obedece ao schema da resposta', async () => {
    findUnique.mockResolvedValue(buildDocument());

    const stored = await repository.findByCnpj(buildCnpj());

    expect(
      CompanyProfileResponseSchema.safeParse(stored?.profile).success,
    ).toBe(true);
  });

  it('completa com null os campos opcionais do endereço que a fonte não trouxe', async () => {
    findUnique.mockResolvedValue(
      buildDocument({
        trade_name: null,
        company_size: null,
        address: { city: 'Campinas', uf: 'SP' },
      }),
    );

    const stored = await repository.findByCnpj(buildCnpj());

    expect(stored?.profile.trade_name).toBeNull();
    expect(stored?.profile.company_size).toBeNull();
    expect(stored?.profile.address).toEqual({
      street: null,
      number: null,
      complement: null,
      neighborhood: null,
      city: 'Campinas',
      city_ibge_code: null,
      uf: 'SP',
      zipcode: null,
    });
  });

  it('aceita uma empresa sem CNAE secundário', async () => {
    findUnique.mockResolvedValue(buildDocument({ secondary_cnaes: [] }));

    const stored = await repository.findByCnpj(buildCnpj());

    expect(stored?.profile.secondary_cnaes).toEqual([]);
  });

  it('perfil que nunca mudou não tem hash anterior', async () => {
    findUnique.mockResolvedValue(
      buildDocument({ previous_content_hash: null }),
    );

    const stored = await repository.findByCnpj(buildCnpj());

    expect(stored?.previousContentHash).toBeNull();
  });

  it('o campo ausente do documento (MongoDB) também vale como sem hash anterior', async () => {
    const document: Record<string, unknown> = buildDocument();
    delete document.previous_content_hash;
    findUnique.mockResolvedValue(document);

    const stored = await repository.findByCnpj(buildCnpj());

    expect(stored?.previousContentHash).toBeNull();
  });

  describe('search', () => {
    const item = {
      cnpj: '11222333000181',
      legal_name: 'ACME LTDA',
      trade_name: null,
      registration_status: 'ATIVA',
      city: 'SAO PAULO',
      uf: 'SP',
      main_cnae: { code: '6201501', description: 'DESENVOLVIMENTO' },
      ods_score: null,
    };

    it('monta o pipeline com os critérios e a janela pedidos', async () => {
      aggregateRaw.mockResolvedValue([{ items: [], total: [] }]);
      const input = {
        nameTerms: ['ACME', 'LTDA'],
        uf: 'SP',
        ods: { number: 15, minScore: -10 },
        skip: 20,
        take: 10,
      };

      await repository.search(input);

      expect(aggregateRaw).toHaveBeenCalledWith({
        pipeline: buildCompanySearchPipeline(input),
      });
    });

    it('devolve a janela e o total do $facet', async () => {
      aggregateRaw.mockResolvedValue([
        { items: [item], total: [{ count: 31 }] },
      ]);

      await expect(
        repository.search({ nameTerms: ['ACME'], skip: 0, take: 20 }),
      ).resolves.toEqual({ items: [item], total: 31 });
    });

    it('sem correspondência o $facet traz a contagem vazia: total 0', async () => {
      aggregateRaw.mockResolvedValue([{ items: [], total: [] }]);

      await expect(
        repository.search({ nameTerms: ['NADA'], skip: 0, take: 20 }),
      ).resolves.toEqual({ items: [], total: 0 });
    });

    it('resposta sem o $facet (coleção vazia) vale como nada encontrado', async () => {
      aggregateRaw.mockResolvedValue([]);

      await expect(
        repository.search({ nameTerms: ['NADA'], skip: 0, take: 20 }),
      ).resolves.toEqual({ items: [], total: 0 });
    });

    it('só devolve os campos do resumo, mesmo que o banco traga mais', async () => {
      aggregateRaw.mockResolvedValue([
        {
          items: [{ ...item, content_hash: 'segredo', qsa: ['socio'] }],
          total: [{ count: 1 }],
        },
      ]);

      const { items } = await repository.search({
        nameTerms: ['ACME'],
        skip: 0,
        take: 20,
      });

      expect(items).toEqual([item]);
      expect(JSON.stringify(items)).not.toContain('segredo');
    });

    it('resposta fora do formato é recusada em vez de repassada', async () => {
      aggregateRaw.mockResolvedValue([{ items: [{ cnpj: 1 }], total: [] }]);

      await expect(
        repository.search({ nameTerms: ['ACME'], skip: 0, take: 20 }),
      ).rejects.toThrow();
    });

    it('propaga a falha do banco', async () => {
      aggregateRaw.mockRejectedValue(new Error('banco fora'));

      await expect(
        repository.search({ nameTerms: ['ACME'], skip: 0, take: 20 }),
      ).rejects.toThrow('banco fora');
    });
  });

  describe('search a partir dos índices (#328)', () => {
    const input = (
      ods: SearchCompaniesInput['ods'],
      overrides: Partial<SearchCompaniesInput> = {},
    ): SearchCompaniesInput => ({
      nameTerms: [],
      skip: 0,
      take: 5,
      ods,
      ...overrides,
    });
    const scoredInput = (
      ods: NonNullable<SearchCompaniesInput['ods']>,
      overrides: Partial<SearchCompaniesInput> = {},
    ) => ({ ...input(ods, overrides), ods });
    const item = (cnpj: string) => ({
      cnpj,
      legal_name: `EMPRESA ${cnpj}`,
      trade_name: null,
      registration_status: 'ATIVA',
      city: 'SAO PAULO',
      uf: 'SP',
      main_cnae: { code: '6201501', description: 'DESENVOLVIMENTO' },
      ods_score: { ods_number: 15, score_value: 10, confidence_value: 0.5 },
    });
    const count = (value: number) => (value === 0 ? [] : [{ count: value }]);
    const facets = (cnpjs: string[], total: number) => [
      { items: cnpjs.map(item), total: count(total) },
    ];

    describe('quem parte do perfil', () => {
      it.each([
        ['sem ODS', undefined, {}],
        ['só o ODS, sem mínimo nem ordem', { number: 15 }, {}],
        [
          'ODS com ordenação e nome',
          { number: 15, order: 'asc' as const },
          { nameTerms: ['AMBEV'] },
        ],
        [
          'ODS com mínimo e nome',
          { number: 15, minScore: 0 },
          { nameTerms: ['AMBEV'] },
        ],
      ])(
        '%s: uma consulta ao perfil, nenhuma aos índices',
        async (_label, ods, extra) => {
          aggregateRaw.mockResolvedValue(facets(['1'], 1));
          const search = input(ods, extra);

          await repository.search(search);

          expect(aggregateRaw).toHaveBeenCalledTimes(1);
          expect(aggregateRaw).toHaveBeenCalledWith({
            pipeline: buildCompanySearchPipeline(search),
          });
          expect(scoreAggregateRaw).not.toHaveBeenCalled();
        },
      );
    });

    describe('mínimos sem ordenação pelo ODS', () => {
      it('uma consulta aos índices, nenhuma ao perfil', async () => {
        scoreAggregateRaw.mockResolvedValue(facets(['1', '2'], 2));
        const search = scoredInput({ number: 15, minScore: 0 });

        const result = await repository.search(search);

        expect(scoreAggregateRaw).toHaveBeenCalledTimes(1);
        expect(scoreAggregateRaw).toHaveBeenCalledWith({
          pipeline: buildScoredFilteredPipeline(search),
        });
        expect(aggregateRaw).not.toHaveBeenCalled();
        expect(result.items.map((i) => i.cnpj)).toEqual(['1', '2']);
        expect(result.total).toBe(2);
      });

      it('nada casou: lista vazia e total zero', async () => {
        scoreAggregateRaw.mockResolvedValue([{ items: [], total: [] }]);

        await expect(
          repository.search(scoredInput({ number: 15, minScore: 90 })),
        ).resolves.toEqual({ items: [], total: 0 });
      });
    });

    describe('ordenação pelo ODS com índice mínimo', () => {
      it('só a lista de quem tem nota: página e contagem nos índices, perfil intocado', async () => {
        const search = scoredInput({ number: 15, minScore: 0, order: 'desc' });

        scoreAggregateRaw
          .mockResolvedValueOnce(count(12))
          .mockResolvedValueOnce(['1', '2', '3', '4', '5'].map(item));

        const result = await repository.search(search);

        expect(scoreAggregateRaw).toHaveBeenNthCalledWith(1, {
          pipeline: buildScoredCountPipeline(search, 'scored'),
        });
        expect(scoreAggregateRaw).toHaveBeenNthCalledWith(2, {
          pipeline: buildScoredPagePipeline(search, 0, 5),
        });
        expect(aggregateRaw).not.toHaveBeenCalled();
        expect(result.total).toBe(12);
        expect(result.items).toHaveLength(5);
      });

      it('com o índice mínimo, quem não tem nota nunca entra: o segundo segmento não existe', async () => {
        const search = scoredInput(
          { number: 15, minScore: 0, order: 'asc' },
          { skip: 8, take: 5 },
        );

        scoreAggregateRaw
          .mockResolvedValueOnce(count(10))
          .mockResolvedValueOnce(['9', '10'].map(item));

        const result = await repository.search(search);

        expect(result.items.map((i) => i.cnpj)).toEqual(['9', '10']);
        expect(result.total).toBe(10);
        expect(aggregateRaw).not.toHaveBeenCalled();
      });
    });

    describe('ordenação pelo ODS sem mínimo: dois segmentos', () => {
      it('a janela cabe nos que têm nota: o perfil só é contado, e não lido', async () => {
        const search = scoredInput({ number: 15, order: 'desc' });

        scoreAggregateRaw
          .mockResolvedValueOnce(count(30))
          .mockResolvedValueOnce(['1', '2', '3', '4', '5'].map(item));
        aggregateRaw.mockResolvedValueOnce(count(40));

        const result = await repository.search(search);

        expect(aggregateRaw).toHaveBeenCalledTimes(1);
        expect(aggregateRaw).toHaveBeenCalledWith({
          pipeline: buildCompanyCountPipeline(search),
        });
        expect(scoreAggregateRaw).toHaveBeenCalledTimes(2);
        expect(result.items).toHaveLength(5);
        expect(result.total).toBe(40);
      });

      it('a janela atravessa a emenda: o fim dos com nota e o começo dos sem nota', async () => {
        const search = scoredInput(
          { number: 15, order: 'asc' },
          { skip: 0, take: 5 },
        );

        scoreAggregateRaw
          .mockResolvedValueOnce(count(3))
          .mockResolvedValueOnce(['1', '2', '3'].map(item))
          .mockResolvedValueOnce([{ cnpj: '1' }, { cnpj: '2' }, { cnpj: '3' }]);
        aggregateRaw
          .mockResolvedValueOnce(count(10))
          .mockResolvedValueOnce(facets(['4', '5'], 7));

        const result = await repository.search(search);

        expect(result.items.map((i) => i.cnpj)).toEqual([
          '1',
          '2',
          '3',
          '4',
          '5',
        ]);
        expect(result.total).toBe(10);
        expect(scoreAggregateRaw).toHaveBeenNthCalledWith(2, {
          pipeline: buildScoredPagePipeline(search, 0, 3),
        });
        expect(scoreAggregateRaw).toHaveBeenNthCalledWith(3, {
          pipeline: buildScoredCnpjsPipeline(search, 'scored'),
        });
        // O segundo segmento começa no primeiro sem nota, sem os que já foram listados.
        expect(aggregateRaw).toHaveBeenNthCalledWith(2, {
          pipeline: buildCompanySearchPipeline(
            { ...search, ods: { number: 15 }, skip: 0, take: 2 },
            { excludeCnpjs: ['1', '2', '3'] },
          ),
        });
      });

      it('a janela inteira cai nos sem nota: o primeiro segmento nem é lido', async () => {
        const search = scoredInput(
          { number: 15, order: 'desc' },
          { skip: 5, take: 4 },
        );

        scoreAggregateRaw
          .mockResolvedValueOnce(count(3))
          .mockResolvedValueOnce([{ cnpj: '1' }, { cnpj: '2' }, { cnpj: '3' }]);
        aggregateRaw
          .mockResolvedValueOnce(count(10))
          .mockResolvedValueOnce(facets(['8', '9', '10', '11'], 7));

        const result = await repository.search(search);

        // 5 - 3 = 2 sem nota já ficaram para trás.
        expect(aggregateRaw).toHaveBeenNthCalledWith(2, {
          pipeline: buildCompanySearchPipeline(
            { ...search, ods: { number: 15 }, skip: 2, take: 4 },
            { excludeCnpjs: ['1', '2', '3'] },
          ),
        });
        expect(scoreAggregateRaw).toHaveBeenCalledTimes(2);
        expect(result.items).toHaveLength(4);
        expect(result.total).toBe(10);
      });

      it('ninguém tem nota: tudo vem do perfil, na ordem da lista', async () => {
        const search = scoredInput({ number: 15, order: 'asc' });

        scoreAggregateRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
        aggregateRaw
          .mockResolvedValueOnce(count(4))
          .mockResolvedValueOnce(facets(['1', '2', '3', '4'], 4));

        const result = await repository.search(search);

        expect(result.items).toHaveLength(4);
        expect(result.total).toBe(4);
        // Nenhuma página dos com nota foi pedida.
        expect(scoreAggregateRaw).toHaveBeenCalledTimes(2);
      });

      it('mais notas que perfis (localização desatualizada): o total nunca fica negativo', async () => {
        const search = scoredInput({ number: 15, order: 'asc' }, { skip: 100 });

        scoreAggregateRaw.mockResolvedValueOnce(count(12));
        aggregateRaw.mockResolvedValueOnce(count(10));

        const result = await repository.search(search);

        expect(result.total).toBe(12);
        expect(result.items).toEqual([]);
      });
    });

    describe('ordenação pelo ODS só com confiança mínima', () => {
      it('os sem nota que passam são os índices sem nota com confiança suficiente', async () => {
        const search = scoredInput(
          { number: 15, minConfidence: 0.5, order: 'asc' },
          { skip: 0, take: 5 },
        );

        // A ordem das consultas: contagem, CNPJs sem nota que passam, página dos com nota.
        scoreAggregateRaw
          .mockResolvedValueOnce(count(2))
          .mockResolvedValueOnce([{ cnpj: '7' }, { cnpj: '8' }, { cnpj: '9' }])
          .mockResolvedValueOnce(['1', '2'].map(item));
        aggregateRaw.mockResolvedValueOnce(facets(['7', '8', '9'], 3));

        const result = await repository.search(search);

        expect(scoreAggregateRaw).toHaveBeenNthCalledWith(2, {
          pipeline: buildScoredCnpjsPipeline(search, 'unscored'),
        });
        expect(scoreAggregateRaw).toHaveBeenNthCalledWith(3, {
          pipeline: buildScoredPagePipeline(search, 0, 2),
        });
        expect(aggregateRaw).toHaveBeenCalledWith({
          pipeline: buildCompanySearchPipeline(
            { ...search, ods: { number: 15 }, skip: 0, take: 3 },
            { includeCnpjs: ['7', '8', '9'] },
          ),
        });
        expect(result.total).toBe(5);
        expect(result.items.map((i) => i.cnpj)).toEqual([
          '1',
          '2',
          '7',
          '8',
          '9',
        ]);
      });

      it('nenhum índice sem nota passa na confiança: só a lista dos com nota', async () => {
        const search = scoredInput({
          number: 15,
          minConfidence: 0.9,
          order: 'asc',
        });

        scoreAggregateRaw
          .mockResolvedValueOnce(count(1))
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(['1'].map(item));

        const result = await repository.search(search);

        expect(aggregateRaw).not.toHaveBeenCalled();
        expect(result.total).toBe(1);
      });
    });

    it('resposta fora do formato é recusada, em qualquer segmento', async () => {
      scoreAggregateRaw
        .mockResolvedValueOnce(count(1))
        .mockResolvedValueOnce([{ cnpj: 1 }]);

      await expect(
        repository.search(
          scoredInput({ number: 15, minScore: 0, order: 'asc' }),
        ),
      ).rejects.toThrow();
    });

    it('propaga a falha do banco', async () => {
      scoreAggregateRaw.mockRejectedValue(new Error('banco fora'));

      await expect(
        repository.search(scoredInput({ number: 15, minScore: 0 })),
      ).rejects.toThrow('banco fora');
    });
  });

  describe('save', () => {
    const sourceId = faker.database.mongodbObjectId();
    const record = {
      cnpj: '11222333000181',
      legalName: 'ACME LTDA',
      tradeName: null,
      registrationStatus: 'ATIVA',
      companySize: null,
      address: {
        street: 'AVENIDA PAULISTA',
        number: '1578',
        complement: null,
        neighborhood: 'BELA VISTA',
        city: 'SAO PAULO',
        cityIbgeCode: null,
        uf: 'SP',
        zipcode: '01310200',
      },
      mainCnae: { code: '6201501', description: 'DESENVOLVIMENTO' },
      secondaryCnaes: [{ code: '6202300', description: 'OUTRA' }],
    };
    const input = {
      record,
      sourceSlug: 'OPEN_CNPJ',
      contentHash: 'novo-hash',
      previousContentHash: 'hash-antigo',
      refreshedAt: new Date('2026-10-16T12:00:00.000Z'),
    };

    beforeEach(() => {
      findSourceOrThrow.mockResolvedValue({ id_data_source: sourceId });
    });

    it('resolve a fonte pelo slug', async () => {
      await repository.save(input);

      expect(findSourceOrThrow).toHaveBeenCalledWith({
        where: { slug: 'OPEN_CNPJ' },
        select: { id_data_source: true },
      });
    });

    it('cria ou atualiza o perfil pelo CNPJ, com os dados do cadastro', async () => {
      await repository.save(input);

      const expected = {
        legal_name: 'ACME LTDA',
        trade_name: null,
        registration_status: 'ATIVA',
        company_size: null,
        address: {
          street: 'AVENIDA PAULISTA',
          number: '1578',
          complement: null,
          neighborhood: 'BELA VISTA',
          city: 'SAO PAULO',
          city_ibge_code: null,
          uf: 'SP',
          zipcode: '01310200',
        },
        main_cnae: { code: '6201501', description: 'DESENVOLVIMENTO' },
        secondary_cnaes: [{ code: '6202300', description: 'OUTRA' }],
        cadastral_source_id: sourceId,
        content_hash: 'novo-hash',
        previous_content_hash: 'hash-antigo',
        refreshed_at: input.refreshedAt,
      };
      expect(upsert).toHaveBeenCalledWith({
        where: { cnpj: '11222333000181' },
        create: { cnpj: '11222333000181', ...expected },
        update: expected,
      });
    });

    it('um campo que deixou de existir na fonte é gravado como null, e não omitido', async () => {
      await repository.save({ ...input, previousContentHash: null });

      const [{ update }] = upsert.mock.calls[0] as [
        { update: Record<string, unknown> },
      ];
      expect(update).toHaveProperty('trade_name', null);
      expect(update).toHaveProperty('company_size', null);
      expect(update).toHaveProperty('previous_content_hash', null);
    });

    it('não grava nada que não seja dado de pessoa jurídica', async () => {
      await repository.save(input);

      const serialized = JSON.stringify(upsert.mock.calls[0]);
      expect(serialized).not.toContain('qsa');
      expect(serialized).not.toContain('socio');
    });

    it('propaga a falha quando a fonte não existe no catálogo', async () => {
      findSourceOrThrow.mockRejectedValue(new Error('fonte inexistente'));

      await expect(repository.save(input)).rejects.toThrow('fonte inexistente');
      expect(upsert).not.toHaveBeenCalled();
    });

    it('propaga a falha do banco', async () => {
      upsert.mockRejectedValue(new Error('banco fora'));

      await expect(repository.save(input)).rejects.toThrow('banco fora');
    });
  });

  it('não devolve campos internos da coleção', async () => {
    findUnique.mockResolvedValue(buildDocument());

    const stored = await repository.findByCnpj(buildCnpj());
    const serialized = JSON.stringify(stored?.profile);

    expect(serialized).not.toContain('content_hash');
    expect(serialized).not.toContain('previous_content_hash');
    expect(serialized).not.toContain('cadastral_source');
    expect(serialized).not.toContain('id_company_profile');
  });
});
