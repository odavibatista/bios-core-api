import { GetIbamaCompanyEvidencesUseCase } from '@modules/ibama/infra/usecases/get-ibama-company-evidences.usecase.js';
import { GetGhgCompanyEvidencesUseCase } from '@modules/ghg/infra/usecases/get-ghg-company-evidences.usecase.js';
import { storedEvidenceFactory } from '@test/factories/evidences/evidence.factory.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { RequestCguCompanyEvidencesUseCase } from './request-cgu-company-evidences.usecase.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { groupCompanyEvidences } from '@modules/evidences/domain/company-environmental-evidences.dto.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import {
  ENVIRONMENTAL_PROFILE_CACHE_TTL_SECONDS,
  GetCompanyEnvironmentalEvidencesUseCase,
} from './get-company-environmental-evidences.usecase.js';
import { Test } from '@nestjs/testing';
import { RequestScoreRecalculationUseCase } from '@modules/scoring/infra/usecases/request-score-recalculation.usecase.js';
import { CompanyProfileRepository } from '@modules/companies/domain/dtos/repositories/company-profile.repository.js';
import { CompanyNotFoundException } from '@modules/companies/domain/dtos/errors/company-not-found.exception.js';
describe('UC07 fontes independentes', () => {
  const profiles = { findByCnpj: vi.fn() };
  const ibama = { execute: vi.fn() },
    cgu = { execute: vi.fn() },
    ghg = { execute: vi.fn() },
    list = { execute: vi.fn() },
    collection = {
      execute: vi.fn<RecordEvidenceCollectionUseCase['execute']>(),
    },
    scores = {
      execute: vi.fn<RequestScoreRecalculationUseCase['execute']>(),
    },
    cache = {
      get: vi.fn<CacheProvider['get']>(),
      set: vi.fn<CacheProvider['set']>(),
    };
  const cnpj = buildCnpj();
  let useCase: GetCompanyEnvironmentalEvidencesUseCase;
  beforeEach(async () => {
    vi.resetAllMocks();
    profiles.findByCnpj.mockResolvedValue({ profile: { cnpj } });
    for (const mock of [ibama, cgu, ghg]) mock.execute.mockResolvedValue([]);
    list.execute.mockResolvedValue([storedEvidenceFactory.build({ cnpj })]);
    scores.execute.mockResolvedValue('CALCULATED');
    cache.get.mockResolvedValue(undefined);
    cache.set.mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        GetCompanyEnvironmentalEvidencesUseCase,
        { provide: CompanyProfileRepository, useValue: profiles },
        { provide: GetIbamaCompanyEvidencesUseCase, useValue: ibama },
        { provide: RequestCguCompanyEvidencesUseCase, useValue: cgu },
        { provide: GetGhgCompanyEvidencesUseCase, useValue: ghg },
        { provide: ListCompanyEvidencesUseCase, useValue: list },
        { provide: RecordEvidenceCollectionUseCase, useValue: collection },
        { provide: RequestScoreRecalculationUseCase, useValue: scores },
        { provide: CacheProvider, useValue: cache },
      ],
    }).compile();
    useCase = module.get(GetCompanyEnvironmentalEvidencesUseCase);
  });
  describe('sem espera (API pública, #333)', () => {
    it('não espera as coletas nem o recálculo: repassa wait=false a cada etapa', async () => {
      await useCase.execute(cnpj, { wait: false });

      expect(cgu.execute).toHaveBeenCalledWith(cnpj, { wait: false });
      expect(ghg.execute).toHaveBeenCalledWith(cnpj, { wait: false });
      expect(scores.execute).toHaveBeenCalledExactlyOnceWith({
        cnpj,
        wait: false,
      });
    });

    it('por padrão espera, como o painel e a rota de evidências', async () => {
      await useCase.execute(cnpj);

      expect(cgu.execute).toHaveBeenCalledWith(cnpj, { wait: true });
      expect(ghg.execute).toHaveBeenCalledWith(cnpj, { wait: true });
      expect(scores.execute).toHaveBeenCalledExactlyOnceWith({
        cnpj,
        wait: true,
      });
    });
  });

  describe('recálculo do índice (UC15, diagrama 3)', () => {
    it('com as fontes consolidadas, pede o recálculo e espera, antes de reler o estado', async () => {
      const order: string[] = [];
      for (const mock of [ibama, cgu, ghg]) {
        mock.execute.mockImplementation(() => {
          order.push('fonte');

          return Promise.resolve([]);
        });
      }
      scores.execute.mockImplementation(() => {
        order.push('recálculo');

        return Promise.resolve('CALCULATED');
      });
      list.execute.mockImplementation(() => {
        order.push('relê');

        return Promise.resolve([storedEvidenceFactory.build({ cnpj })]);
      });

      await useCase.execute(cnpj);

      expect(scores.execute).toHaveBeenCalledExactlyOnceWith({
        cnpj,
        wait: true,
      });
      expect(order).toEqual(['fonte', 'fonte', 'fonte', 'recálculo', 'relê']);
    });

    it('recálculo que não concluiu no prazo (DEGRADED) não derruba a consulta', async () => {
      scores.execute.mockResolvedValue('DEGRADED');

      await expect(useCase.execute(cnpj)).resolves.toMatchObject({ cnpj });
    });

    it('CNPJ inválido ou sem perfil cadastral: nenhuma fonte, nenhum recálculo', async () => {
      profiles.findByCnpj.mockResolvedValue(null);

      await expect(useCase.execute(cnpj)).rejects.toBeInstanceOf(
        CompanyNotFoundException,
      );
      await expect(useCase.execute('invalido')).rejects.toThrow(/CNPJ/);

      expect(scores.execute).not.toHaveBeenCalled();
    });
  });

  describe('retrato em cache, o mesmo do perfil completo (#334)', () => {
    const key = {
      namespace: CacheNamespace.COMPANY_EVIDENCES,
      identifier: cnpj,
    };

    it('com o retrato em cache, devolve-o sem coletar, recalcular nem reler o banco', async () => {
      const { categories } = groupCompanyEvidences(cnpj, [
        storedEvidenceFactory.build({ cnpj }),
      ]);
      cache.get.mockResolvedValue(categories);

      await expect(useCase.execute(cnpj)).resolves.toEqual({
        cnpj,
        categories,
      });

      expect(cache.get).toHaveBeenCalledExactlyOnceWith(key);
      for (const source of [ibama, cgu, ghg])
        expect(source.execute).not.toHaveBeenCalled();
      expect(scores.execute).not.toHaveBeenCalled();
      expect(list.execute).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('cache fora do formato conta como ausência: coleta normalmente', async () => {
      cache.get.mockResolvedValue({ inesperado: true });

      await useCase.execute(cnpj);

      expect(ibama.execute).toHaveBeenCalledOnce();
      expect(list.execute).toHaveBeenCalledOnce();
    });

    it('guarda o retrato que o índice já reflete (recálculo CALCULATED), pelo prazo do perfil', async () => {
      const result = await useCase.execute(cnpj);

      expect(cache.set).toHaveBeenCalledExactlyOnceWith(
        key,
        result.categories,
        ENVIRONMENTAL_PROFILE_CACHE_TTL_SECONDS,
      );
    });

    it.each([
      ['recálculo fora do prazo', 'DEGRADED', true],
      ['sem espera (API pública)', 'REQUESTED', false],
    ] as const)(
      'não guarda o retrato quando o índice pode não refleti-lo: %s',
      async (_, outcome, wait) => {
        scores.execute.mockResolvedValue(outcome);

        await useCase.execute(cnpj, { wait });

        expect(cache.set).not.toHaveBeenCalled();
      },
    );

    it('CNPJ sem perfil cadastral responde 404 antes de consultar o cache', async () => {
      profiles.findByCnpj.mockResolvedValue(null);

      await expect(useCase.execute(cnpj)).rejects.toBeInstanceOf(
        CompanyNotFoundException,
      );
      expect(cache.get).not.toHaveBeenCalled();
    });
  });
  it('inicia todas as fontes antes de esperar e rele o estado persistido', async () => {
    let resolve!: () => void;
    ibama.execute.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const pending = useCase.execute(cnpj);
    await Promise.resolve();
    await Promise.resolve();
    expect(cgu.execute).toHaveBeenCalledWith(cnpj, { wait: true });
    expect(ghg.execute).toHaveBeenCalledWith(cnpj, { wait: true });
    expect(list.execute).not.toHaveBeenCalled();
    resolve();
    const result = await pending;
    expect(result.cnpj).toBe(cnpj);
    expect(result.categories.flatMap((g) => g.evidences)).toHaveLength(1);
    expect(collection.execute).not.toHaveBeenCalled();
  });
  it.each([
    ['IBAMA', ['IBAMA']],
    ['CGU', ['CGU_CEIS', 'CGU_CNEP']],
    ['GHG', ['GHG_PROTOCOL']],
  ] as const)('queda %s conserva outras fontes', async (name, slugs) => {
    ({ IBAMA: ibama, CGU: cgu, GHG: ghg })[name].execute.mockRejectedValue(
      new Error('fonte fora'),
    );
    const result = await useCase.execute(cnpj);
    expect(
      collection.execute.mock.calls.map(([arg]) => arg.sourceSlug),
    ).toEqual([...slugs]);
    for (const sourceSlug of slugs)
      expect(collection.execute).toHaveBeenCalledWith({
        cnpj,
        sourceSlug,
        result: { status: 'UNAVAILABLE' },
      });
    expect(result.categories.flatMap((g) => g.evidences)).toHaveLength(1);
  });
  it('recusa CNPJ invalido antes de publicar ou consultar', async () => {
    await expect(useCase.execute('invalido')).rejects.toThrow(/CNPJ/);
    expect(ibama.execute).not.toHaveBeenCalled();
    expect(list.execute).not.toHaveBeenCalled();
    expect(profiles.findByCnpj).not.toHaveBeenCalled();
  });
  it('recusa CNPJ sem perfil antes de ler, gravar ou acionar fontes', async () => {
    profiles.findByCnpj.mockResolvedValue(null);
    await expect(useCase.execute(cnpj)).rejects.toBeInstanceOf(
      CompanyNotFoundException,
    );
    expect(profiles.findByCnpj).toHaveBeenCalledWith(cnpj);
    for (const source of [ibama, cgu, ghg])
      expect(source.execute).not.toHaveBeenCalled();
    expect(list.execute).not.toHaveBeenCalled();
    expect(collection.execute).not.toHaveBeenCalled();
  });
  it('propaga falha na leitura do perfil sem acionar fontes', async () => {
    profiles.findByCnpj.mockRejectedValue(new Error('banco fora'));
    await expect(useCase.execute(cnpj)).rejects.toThrow('banco fora');
    expect(ibama.execute).not.toHaveBeenCalled();
  });
  it('nao disfarca falha global de persistencia como ausencia', async () => {
    list.execute.mockRejectedValue(new Error('banco fora'));
    await expect(useCase.execute(cnpj)).rejects.toThrow('banco fora');
  });
});
