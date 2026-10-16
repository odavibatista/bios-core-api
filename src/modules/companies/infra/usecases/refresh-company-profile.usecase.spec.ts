import { Test } from '@nestjs/testing';
import { RequestTrigger } from '@prisma/client';
import type { CadastralRecord } from '@modules/data-sources/domain/dtos/providers/cadastral-record.dto.js';
import { ReceitaDataSource } from '@modules/receita/infra/providers/receita.data-source.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { storedCompanyProfileFactory } from '@test/factories/companies/company-profile.factory.js';
import { computeCadastralContentHash } from '../../domain/cadastral-content-hash.js';
import { CompanyProfileRepository } from '../../domain/dtos/repositories/company-profile.repository.js';
import { RefreshCompanyProfileUseCase } from './refresh-company-profile.usecase.js';
import { ResolveCnaeDescriptionsUseCase } from './resolve-cnae-descriptions.usecase.js';

const CNPJ = '11222333000181';

function buildRecord(
  overrides: Partial<CadastralRecord> = {},
): CadastralRecord {
  return {
    cnpj: CNPJ,
    legalName: 'ACME SERVICOS LTDA',
    tradeName: 'ACME',
    registrationStatus: 'ATIVA',
    companySize: 'DEMAIS',
    address: {
      street: 'AVENIDA PAULISTA',
      number: '1578',
      complement: null,
      neighborhood: 'BELA VISTA',
      city: 'SAO PAULO',
      cityIbgeCode: '3550308',
      uf: 'SP',
      zipcode: '01310200',
    },
    mainCnae: { code: '6201501', description: 'Desenvolvimento do provedor' },
    secondaryCnaes: [
      { code: '6202300', description: 'Outra do provedor' },
      { code: '6311900', description: '' },
    ],
    ...overrides,
  };
}

describe('RefreshCompanyProfileUseCase', () => {
  const receita = { fetch: vi.fn() };
  const cnae = { execute: vi.fn() };
  const repository = {
    findByCnpj: vi.fn<CompanyProfileRepository['findByCnpj']>(),
    save: vi.fn<CompanyProfileRepository['save']>(),
  };
  const cache = { delete: vi.fn<CacheProvider['delete']>() };
  let useCase: RefreshCompanyProfileUseCase;

  /** O que foi enviado a `save`. */
  const saved = () => repository.save.mock.calls[0][0];

  const providerAnswers = (
    record: CadastralRecord,
    sourceSlug = 'BRASIL_API',
  ) =>
    receita.fetch.mockResolvedValue({
      status: 'FOUND',
      data: { record, sourceSlug },
    });

  beforeEach(async () => {
    vi.useFakeTimers({ now: new Date('2026-10-16T12:00:00.000Z') });
    receita.fetch.mockReset();
    providerAnswers(buildRecord());
    cnae.execute.mockResolvedValue(new Map());
    repository.findByCnpj.mockResolvedValue(null);
    repository.save.mockResolvedValue(undefined);
    cache.delete.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RefreshCompanyProfileUseCase,
        { provide: ReceitaDataSource, useValue: receita },
        { provide: ResolveCnaeDescriptionsUseCase, useValue: cnae },
        { provide: CompanyProfileRepository, useValue: repository },
        { provide: CacheProvider, useValue: cache },
      ],
    }).compile();

    useCase = moduleRef.get(RefreshCompanyProfileUseCase);
  });

  afterEach(() => {
    vi.useRealTimers();
    repository.save.mockReset();
  });

  describe('cadastro encontrado', () => {
    it('grava o cadastro e responde FOUND', async () => {
      await expect(useCase.execute(CNPJ)).resolves.toEqual({
        outcome: 'FOUND',
      });

      expect(repository.save).toHaveBeenCalledOnce();
    });

    it('consulta a cadeia com o CNPJ e a origem "job sob demanda"', async () => {
      await useCase.execute(CNPJ);

      expect(receita.fetch).toHaveBeenCalledWith(CNPJ, {
        trigger: RequestTrigger.ON_DEMAND_JOB,
      });
    });

    it('guarda o provedor que respondeu e o instante da atualização', async () => {
      providerAnswers(buildRecord(), 'MINHA_RECEITA');

      await useCase.execute(CNPJ);

      expect(saved()).toMatchObject({
        sourceSlug: 'MINHA_RECEITA',
        refreshedAt: new Date('2026-10-16T12:00:00.000Z'),
      });
    });

    it('descarta a cópia do perfil em cache, para a próxima leitura trazer o dado novo', async () => {
      await useCase.execute(CNPJ);

      expect(cache.delete).toHaveBeenCalledWith({
        namespace: CacheNamespace.COMPANY_PROFILE,
        identifier: CNPJ,
      });
    });

    it('só descarta o cache depois de gravar', async () => {
      repository.save.mockRejectedValue(new Error('banco fora'));

      await expect(useCase.execute(CNPJ)).rejects.toThrow('banco fora');

      expect(cache.delete).not.toHaveBeenCalled();
    });
  });

  describe('descrição dos CNAEs (IBGE)', () => {
    it('pede as descrições do principal e dos secundários', async () => {
      await useCase.execute(CNPJ);

      expect(cnae.execute).toHaveBeenCalledWith({
        codes: ['6201501', '6202300', '6311900'],
        context: { trigger: RequestTrigger.ON_DEMAND_JOB },
      });
    });

    it('a descrição oficial substitui a do provedor', async () => {
      cnae.execute.mockResolvedValue(
        new Map([
          ['6201501', 'OFICIAL PRINCIPAL'],
          ['6311900', 'OFICIAL VAZIA NO PROVEDOR'],
        ]),
      );

      await useCase.execute(CNPJ);

      expect(saved().record.mainCnae).toEqual({
        code: '6201501',
        description: 'OFICIAL PRINCIPAL',
      });
      expect(saved().record.secondaryCnaes).toEqual([
        { code: '6202300', description: 'Outra do provedor' },
        { code: '6311900', description: 'OFICIAL VAZIA NO PROVEDOR' },
      ]);
    });

    it('sem a descrição oficial, mantém a do provedor (e grava mesmo assim)', async () => {
      await useCase.execute(CNPJ);

      expect(saved().record.mainCnae.description).toBe(
        'Desenvolvimento do provedor',
      );
    });
  });

  describe('dado de pessoa física (INL02)', () => {
    it('mascara o CPF na razão social e no nome fantasia do empresário individual', async () => {
      providerAnswers(
        buildRecord({
          legalName: 'JOSE DA SILVA 12345678901',
          tradeName: 'JOSE INFORMATICA 123.456.789-01',
        }),
      );

      await useCase.execute(CNPJ);

      expect(saved().record.legalName).toBe('JOSE DA SILVA ***');
      expect(saved().record.tradeName).toBe('JOSE INFORMATICA ***');
      expect(JSON.stringify(saved())).not.toContain('12345678901');
    });

    it('o hash é calculado sobre o cadastro já mascarado', async () => {
      providerAnswers(buildRecord({ legalName: 'JOSE 12345678901' }));

      await useCase.execute(CNPJ);

      expect(saved().contentHash).toBe(
        computeCadastralContentHash(saved().record),
      );
    });

    it('preserva a ausência de nome fantasia', async () => {
      providerAnswers(buildRecord({ tradeName: null }));

      await useCase.execute(CNPJ);

      expect(saved().record.tradeName).toBeNull();
    });
  });

  describe('histórico por hash de conteúdo', () => {
    it('empresa nova: sem hash anterior', async () => {
      await useCase.execute(CNPJ);

      expect(saved().previousContentHash).toBeNull();
      expect(saved().contentHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('cadastro mudou: o hash que estava gravado vira o anterior', async () => {
      repository.findByCnpj.mockResolvedValue(
        storedCompanyProfileFactory.build({
          contentHash: 'hash-antigo',
          previousContentHash: 'hash-mais-antigo',
        }),
      );

      await useCase.execute(CNPJ);

      expect(saved().previousContentHash).toBe('hash-antigo');
    });

    it('cadastro igual: reatualizar não apaga o histórico da última mudança', async () => {
      const first = await runOnce();
      repository.findByCnpj.mockResolvedValue(
        storedCompanyProfileFactory.build({
          contentHash: first.contentHash,
          previousContentHash: 'hash-da-ultima-mudanca',
        }),
      );

      await useCase.execute(CNPJ);

      expect(saved().previousContentHash).toBe('hash-da-ultima-mudanca');
    });

    /** Roda uma vez, sem cadastro prévio, e devolve o que foi gravado. */
    async function runOnce() {
      await useCase.execute(CNPJ);
      const input = saved();
      repository.save.mockClear();

      return input;
    }

    it('trocar de provedor, com o mesmo cadastro, não muda o hash', async () => {
      const first = await runOnce();
      providerAnswers(
        buildRecord({
          address: { ...buildRecord().address, cityIbgeCode: null },
        }),
        'OPEN_CNPJ',
      );

      await useCase.execute(CNPJ);

      expect(saved().contentHash).toBe(first.contentHash);
    });
  });

  describe('código IBGE do município', () => {
    const storedIn = (city: string, uf: string, ibge: string | null) =>
      storedCompanyProfileFactory.build({
        profile: {
          ...storedCompanyProfileFactory.build().profile,
          address: {
            street: null,
            number: null,
            complement: null,
            neighborhood: null,
            city,
            city_ibge_code: ibge,
            uf,
            zipcode: null,
          },
        },
      });

    beforeEach(() => {
      providerAnswers(
        buildRecord({
          address: { ...buildRecord().address, cityIbgeCode: null },
        }),
        'OPEN_CNPJ',
      );
    });

    it('mantém o já conhecido quando o provedor não o informa e o município é o mesmo', async () => {
      repository.findByCnpj.mockResolvedValue(
        storedIn('SAO PAULO', 'SP', '3550308'),
      );

      await useCase.execute(CNPJ);

      expect(saved().record.address.cityIbgeCode).toBe('3550308');
    });

    it('não reaproveita o código de outro município: a empresa mudou de cidade', async () => {
      repository.findByCnpj.mockResolvedValue(
        storedIn('CAMPINAS', 'SP', '3509502'),
      );

      await useCase.execute(CNPJ);

      expect(saved().record.address.cityIbgeCode).toBeNull();
    });

    it('sem perfil anterior, fica sem código', async () => {
      await useCase.execute(CNPJ);

      expect(saved().record.address.cityIbgeCode).toBeNull();
    });

    it('perfil anterior sem código também não inventa um', async () => {
      repository.findByCnpj.mockResolvedValue(
        storedIn('SAO PAULO', 'SP', null),
      );

      await useCase.execute(CNPJ);

      expect(saved().record.address.cityIbgeCode).toBeNull();
    });

    it('o código que o provedor informa prevalece sobre o guardado', async () => {
      providerAnswers(buildRecord());
      repository.findByCnpj.mockResolvedValue(
        storedIn('SAO PAULO', 'SP', '0000001'),
      );

      await useCase.execute(CNPJ);

      expect(saved().record.address.cityIbgeCode).toBe('3550308');
    });
  });

  describe('sem cadastro', () => {
    it('todos os provedores sem o CNPJ: NOT_FOUND, sem gravar', async () => {
      receita.fetch.mockResolvedValue({ status: 'NOT_FOUND' });

      await expect(useCase.execute(CNPJ)).resolves.toEqual({
        outcome: 'NOT_FOUND',
      });

      expect(repository.save).not.toHaveBeenCalled();
      expect(cache.delete).not.toHaveBeenCalled();
    });

    it('provedores indisponíveis: SOURCES_UNAVAILABLE como resultado, e não erro', async () => {
      receita.fetch.mockResolvedValue({
        status: 'UNAVAILABLE',
        reason: 'TIMEOUT',
        message: 'BRASIL_API: TIMEOUT',
      });

      await expect(useCase.execute(CNPJ)).resolves.toEqual({
        outcome: 'SOURCES_UNAVAILABLE',
      });

      expect(repository.save).not.toHaveBeenCalled();
    });

    it('indisponível sem mensagem também é resultado', async () => {
      receita.fetch.mockResolvedValue({
        status: 'UNAVAILABLE',
        reason: 'DISABLED',
      });

      await expect(useCase.execute(CNPJ)).resolves.toEqual({
        outcome: 'SOURCES_UNAVAILABLE',
      });
    });
  });

  describe('falhas nossas propagam, para a fila repetir', () => {
    it('falha ao gravar', async () => {
      repository.save.mockRejectedValue(new Error('banco fora'));

      await expect(useCase.execute(CNPJ)).rejects.toThrow('banco fora');
    });

    it('falha ao ler o perfil anterior', async () => {
      repository.findByCnpj.mockRejectedValue(new Error('banco fora'));

      await expect(useCase.execute(CNPJ)).rejects.toThrow('banco fora');
      expect(repository.save).not.toHaveBeenCalled();
    });
  });
});
