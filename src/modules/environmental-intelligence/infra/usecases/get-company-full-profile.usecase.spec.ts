import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { groupCompanyEvidences } from '@modules/evidences/domain/company-environmental-evidences.dto.js';
import { companyProfileResponseFactory } from '@test/factories/companies/company-profile.factory.js';
import {
  calculatedOdsScoreFactory,
  pendingOdsScoreFactory,
} from '@test/factories/companies/company-full-profile.factory.js';
import {
  ENVIRONMENTAL_PROFILE_CACHE_TTL_SECONDS,
  GetCompanyFullProfileUseCase,
} from './get-company-full-profile.usecase.js';

describe('GetCompanyFullProfileUseCase', () => {
  const CNPJ = '11222333000181';
  const profile = { execute: vi.fn() };
  const evidences = { execute: vi.fn() };
  const scores = { execute: vi.fn() };
  const cache = { get: vi.fn(), set: vi.fn() };
  const calls: string[] = [];
  let useCase: GetCompanyFullProfileUseCase;

  beforeEach(() => {
    calls.length = 0;
    cache.get.mockResolvedValue(undefined);
    cache.set.mockResolvedValue(undefined);
    useCase = new GetCompanyFullProfileUseCase(
      profile as never,
      evidences as never,
      scores as never,
      cache as never,
    );
  });

  function arrange(odsScores = [calculatedOdsScoreFactory.build()]) {
    const cadastral = companyProfileResponseFactory.build({ cnpj: CNPJ });
    profile.execute.mockImplementation(() => {
      calls.push('cadastro');

      return Promise.resolve(cadastral);
    });
    evidences.execute.mockImplementation(() => {
      calls.push('evidências');

      return Promise.resolve(groupCompanyEvidences(CNPJ, []));
    });
    scores.execute.mockImplementation(() => {
      calls.push('índices');

      return Promise.resolve(odsScores);
    });

    return cadastral;
  }

  it('mantém o cadastro na raiz e acrescenta evidências e índices por ODS', async () => {
    const cadastral = arrange();

    const result = await useCase.execute(' 11.222.333/0001-81 ');

    expect(result).toMatchObject(cadastral);
    expect(result.evidences.length).toBeGreaterThan(0);
    expect(result.ods_scores).toEqual([calculatedOdsScoreFactory.build()]);
    expect(profile.execute).toHaveBeenCalledWith(' 11.222.333/0001-81 ');
  });

  it('usa o CNPJ canônico do cadastro nas etapas seguintes', async () => {
    arrange();

    await useCase.execute('11.222.333/0001-81');

    expect(evidences.execute).toHaveBeenCalledWith(CNPJ);
    expect(scores.execute).toHaveBeenCalledWith(CNPJ);
  });

  it('segue a ordem cadastro, evidências, índices', async () => {
    arrange();

    await useCase.execute(CNPJ);

    expect(calls).toEqual(['cadastro', 'evidências', 'índices']);
  });

  it('a falha do cadastro (inválido, inexistente ou indisponível) impede qualquer coleta ambiental', async () => {
    profile.execute.mockRejectedValue(new Error('não encontrada'));

    await expect(useCase.execute(CNPJ)).rejects.toThrow('não encontrada');

    expect(evidences.execute).not.toHaveBeenCalled();
    expect(scores.execute).not.toHaveBeenCalled();
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('falha das evidências não chega a ler os índices nem grava cache', async () => {
    arrange();
    evidences.execute.mockRejectedValue(new Error('banco fora'));

    await expect(useCase.execute(CNPJ)).rejects.toThrow('banco fora');

    expect(scores.execute).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  describe('cache das partes ambientais', () => {
    const evidencesKey = {
      namespace: CacheNamespace.COMPANY_EVIDENCES,
      identifier: CNPJ,
    };
    const scoresKey = {
      namespace: CacheNamespace.COMPANY_SCORES,
      identifier: CNPJ,
    };

    it('com índices calculados, guarda evidências e índices pela validade curta', async () => {
      arrange();

      const result = await useCase.execute(CNPJ);

      expect(cache.set).toHaveBeenCalledTimes(2);
      expect(cache.set).toHaveBeenCalledWith(
        evidencesKey,
        result.evidences,
        ENVIRONMENTAL_PROFILE_CACHE_TTL_SECONDS,
      );
      expect(cache.set).toHaveBeenCalledWith(
        scoresKey,
        result.ods_scores,
        ENVIRONMENTAL_PROFILE_CACHE_TTL_SECONDS,
      );
    });

    it('com algum ODS pendente, não guarda nada: a lacuna é refeita na consulta seguinte', async () => {
      arrange([
        calculatedOdsScoreFactory.build(),
        pendingOdsScoreFactory.build(),
      ]);

      await useCase.execute(CNPJ);

      expect(cache.set).not.toHaveBeenCalled();
    });

    it('com as duas partes em cache, serve delas sem coletar nem ler índices', async () => {
      const cadastral = arrange();
      const cachedScores = [
        calculatedOdsScoreFactory.build({ ods_number: 15 }),
      ];
      const cachedEvidences = groupCompanyEvidences(CNPJ, []).categories;
      cache.get.mockImplementation(({ namespace }: { namespace: string }) =>
        Promise.resolve(
          namespace === CacheNamespace.COMPANY_EVIDENCES
            ? cachedEvidences
            : cachedScores,
        ),
      );

      const result = await useCase.execute(CNPJ);

      expect(result).toEqual({
        ...cadastral,
        evidences: cachedEvidences,
        ods_scores: cachedScores,
      });
      expect(evidences.execute).not.toHaveBeenCalled();
      expect(scores.execute).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('com só uma das partes em cache, refaz as duas', async () => {
      arrange();
      cache.get.mockImplementation(({ namespace }: { namespace: string }) =>
        Promise.resolve(
          namespace === CacheNamespace.COMPANY_SCORES
            ? [calculatedOdsScoreFactory.build()]
            : undefined,
        ),
      );

      await useCase.execute(CNPJ);

      expect(evidences.execute).toHaveBeenCalledTimes(1);
      expect(scores.execute).toHaveBeenCalledTimes(1);
    });

    it('descarta entrada de cache fora do formato atual e refaz', async () => {
      arrange();
      cache.get.mockResolvedValue({ formato: 'antigo' });

      await useCase.execute(CNPJ);

      expect(evidences.execute).toHaveBeenCalledTimes(1);
      expect(cache.set).toHaveBeenCalledTimes(2);
    });
  });
});
