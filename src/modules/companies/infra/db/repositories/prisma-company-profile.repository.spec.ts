import { Test } from '@nestjs/testing';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { faker } from '@test/support/faker.js';
import { CompanyProfileResponseSchema } from '../../../domain/dtos/requests/company-profile.dto.js';
import { PrismaCompanyProfileRepository } from './prisma-company-profile.repository.js';

describe('PrismaCompanyProfileRepository', () => {
  const findUnique = vi.fn();
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
          useValue: { companyProfile: { findUnique } },
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
