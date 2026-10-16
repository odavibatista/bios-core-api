import { Test } from '@nestjs/testing';
import { RequestTrigger } from '@prisma/client';
import type { SourceLookupResult } from '@modules/data-sources/domain/data-source.interface.js';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import { IbgeCnaeDataSource } from '@modules/ibge-cnae/infra/providers/ibge-cnae.data-source.js';
import type { CnaeDescription } from '@modules/ibge-cnae/domain/dtos/providers/cnae-description.dto.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { ResolveCnaeDescriptionsUseCase } from './resolve-cnae-descriptions.usecase.js';

const context = { trigger: RequestTrigger.ON_DEMAND_JOB };
const TTL_SECONDS = 30 * 86_400;

const found = (
  code: string,
  description: string,
): SourceLookupResult<CnaeDescription> => ({
  status: 'FOUND',
  data: { code, description },
});

describe('ResolveCnaeDescriptionsUseCase', () => {
  const cache = {
    get: vi.fn<CacheProvider['get']>(),
    set: vi.fn<CacheProvider['set']>(),
  };
  const ibge = { fetch: vi.fn() };
  const resolveTtl = { execute: vi.fn() };
  let useCase: ResolveCnaeDescriptionsUseCase;

  beforeEach(async () => {
    cache.get.mockResolvedValue(undefined);
    cache.set.mockResolvedValue(undefined);
    resolveTtl.execute.mockResolvedValue(TTL_SECONDS);
    ibge.fetch.mockImplementation((code: string) =>
      Promise.resolve(found(code, `DESCRIÇÃO ${code}`)),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ResolveCnaeDescriptionsUseCase,
        { provide: CacheProvider, useValue: cache },
        { provide: IbgeCnaeDataSource, useValue: ibge },
        { provide: ResolveSourceCacheTtlUseCase, useValue: resolveTtl },
      ],
    }).compile();

    useCase = moduleRef.get(ResolveCnaeDescriptionsUseCase);
  });

  it('devolve a descrição oficial de cada código', async () => {
    const result = await useCase.execute({
      codes: ['6201501', '6202300'],
      context,
    });

    expect(Object.fromEntries(result)).toEqual({
      '6201501': 'DESCRIÇÃO 6201501',
      '6202300': 'DESCRIÇÃO 6202300',
    });
  });

  it('consulta cada código uma vez, mesmo repetido, com o contexto recebido', async () => {
    await useCase.execute({
      codes: ['6201501', '6201501', '6202300'],
      context,
    });

    expect(ibge.fetch).toHaveBeenCalledTimes(2);
    expect(ibge.fetch).toHaveBeenCalledWith('6201501', context);
  });

  it('sem códigos, não consulta nada', async () => {
    await expect(useCase.execute({ codes: [], context })).resolves.toEqual(
      new Map(),
    );

    expect(ibge.fetch).not.toHaveBeenCalled();
  });

  describe('cache', () => {
    it('guarda a descrição pela janela do catálogo, no namespace dos CNAEs', async () => {
      await useCase.execute({ codes: ['6201501'], context });

      expect(resolveTtl.execute).toHaveBeenCalledWith('IBGE_CNAE');
      expect(cache.set).toHaveBeenCalledWith(
        { namespace: CacheNamespace.CNAE_DESCRIPTION, identifier: '6201501' },
        { description: 'DESCRIÇÃO 6201501' },
        TTL_SECONDS,
      );
    });

    it('código em cache não consulta o IBGE', async () => {
      cache.get.mockResolvedValue({ description: 'DO CACHE' });

      const result = await useCase.execute({ codes: ['6201501'], context });

      expect(result.get('6201501')).toBe('DO CACHE');
      expect(ibge.fetch).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    });

    it.each([
      ['sem descrição', {}],
      ['com descrição vazia', { description: '' }],
      ['de outro formato', 'texto'],
    ])(
      'entrada em cache %s é descartada e consultada de novo',
      async (_case, value) => {
        cache.get.mockResolvedValue(value);

        const result = await useCase.execute({ codes: ['6201501'], context });

        expect(result.get('6201501')).toBe('DESCRIÇÃO 6201501');
        expect(ibge.fetch).toHaveBeenCalledOnce();
      },
    );
  });

  describe('código inexistente na taxonomia', () => {
    it('fica de fora do resultado e não vai ao cache, sem parar a rodada', async () => {
      ibge.fetch.mockImplementation((code: string) =>
        Promise.resolve(
          code === '9999999'
            ? ({ status: 'NOT_FOUND' } as const)
            : found(code, `DESCRIÇÃO ${code}`),
        ),
      );

      const result = await useCase.execute({
        codes: ['9999999', '6201501'],
        context,
      });

      expect([...result.keys()]).toEqual(['6201501']);
      expect(cache.set).toHaveBeenCalledOnce();
    });
  });

  describe('IBGE fora do ar', () => {
    it('ao primeiro "indisponível", para de consultar os demais códigos', async () => {
      ibge.fetch.mockResolvedValue({
        status: 'UNAVAILABLE',
        reason: 'TIMEOUT',
      });

      const result = await useCase.execute({
        codes: ['6201501', '6202300', '6311900'],
        context,
      });

      expect(result.size).toBe(0);
      expect(ibge.fetch).toHaveBeenCalledOnce();
    });

    it('mesmo parada, a rodada ainda usa o que está em cache', async () => {
      cache.get.mockImplementation(({ identifier }) =>
        Promise.resolve(
          identifier === '6311900' ? { description: 'DO CACHE' } : undefined,
        ),
      );
      ibge.fetch.mockResolvedValue({
        status: 'UNAVAILABLE',
        reason: 'FAILURE',
      });

      const result = await useCase.execute({
        codes: ['6201501', '6202300', '6311900'],
        context,
      });

      expect(Object.fromEntries(result)).toEqual({ '6311900': 'DO CACHE' });
      expect(ibge.fetch).toHaveBeenCalledOnce();
    });

    it('um defeito inesperado no adapter também só deixa as descrições do provedor', async () => {
      ibge.fetch.mockRejectedValue(new Error('defeito'));

      const result = await useCase.execute({
        codes: ['6201501', '6202300'],
        context,
      });

      expect(result.size).toBe(0);
      expect(ibge.fetch).toHaveBeenCalledOnce();
    });

    it('trata defeito que não é Error', async () => {
      ibge.fetch.mockRejectedValue('texto solto');

      await expect(
        useCase.execute({ codes: ['6201501'], context }),
      ).resolves.toEqual(new Map());
    });
  });
});
