import { Test } from '@nestjs/testing';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { faker } from '@test/support/faker.js';
import { CompanyProfileResponseSchema } from '../../../domain/dtos/requests/company-profile.dto.js';
import { PrismaCompanyProfileRepository } from './prisma-company-profile.repository.js';

describe('PrismaCompanyProfileRepository', () => {
  const findUnique = vi.fn();
  const upsert = vi.fn();
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
            companyProfile: { findUnique, upsert },
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
