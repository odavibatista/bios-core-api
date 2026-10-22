import { Test } from '@nestjs/testing';
import { RequestTrigger } from '@prisma/client';
import type { DataSourceRequest } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { ResolveSourceRequestConfigUseCase } from '@modules/data-sources/infra/usecases/request/resolve-source-request-config.usecase.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import {
  ghgEnvelope,
  ghgOrganizationFactory,
  ghgOrganizationsPage,
} from '@test/factories/ghg/ghg.factory.js';
import {
  GHG_ORGANIZATIONS_CACHE_ID,
  GHG_ORGANIZATIONS_PAGE_SIZE,
  GHG_ORGANIZATIONS_TTL_SECONDS,
  GHG_SYNC_BUDGET_MS,
} from '../../domain/ghg-inventory.js';
import {
  GhgOrganizationDirectory,
  GhgOrganizationsUnavailableError,
  GhgSourceDisabledError,
} from './ghg-organization-directory.provider.js';

describe('GhgOrganizationDirectory', () => {
  const request = {
    execute: vi.fn<(request: DataSourceRequest) => Promise<unknown>>(),
  };
  const config = { execute: vi.fn() };
  const cache = { get: vi.fn(), set: vi.fn() };
  const context = { trigger: RequestTrigger.SCHEDULED_JOB };
  const key = {
    namespace: CacheNamespace.GHG_ORGANIZATIONS,
    identifier: GHG_ORGANIZATIONS_CACHE_ID,
  };
  type PageRequest = { maxResultCount: number; skipCount: number };
  let directory: GhgOrganizationDirectory;

  const answer = (body: unknown, status = 200) => ({
    outcome: 'SUCCESS',
    status,
    body,
  });
  /** O portal com este cadastro, paginando como o pedido manda. */
  const portalWith = (
    everything: { id: number; name: string }[],
    pageSize?: number,
  ) =>
    request.execute.mockImplementation((r) => {
      const asked = r.body as PageRequest;

      return Promise.resolve(
        answer(
          ghgOrganizationsPage(everything, {
            maxResultCount: pageSize ?? asked.maxResultCount,
            skipCount: asked.skipCount,
          }),
        ),
      );
    });
  const searches = () => request.execute.mock.calls.map(([r]) => r);

  beforeEach(async () => {
    vi.resetAllMocks();
    config.execute.mockResolvedValue({
      isEnabled: true,
      requestTimeoutMs: 10_000,
    });
    cache.get.mockResolvedValue(undefined);
    cache.set.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        GhgOrganizationDirectory,
        { provide: RequestDataSourceUseCase, useValue: request },
        { provide: ResolveSourceRequestConfigUseCase, useValue: config },
        { provide: CacheProvider, useValue: cache },
      ],
    }).compile();

    directory = moduleRef.get(GhgOrganizationDirectory);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('read', () => {
    it('devolve o cadastro guardado', async () => {
      const stored = {
        syncedAt: new Date().toISOString(),
        organizations: ghgOrganizationFactory.buildMany(3),
      };
      cache.get.mockResolvedValue(stored);

      await expect(directory.read()).resolves.toEqual(stored);

      expect(cache.get).toHaveBeenCalledWith(key);
    });

    it.each([
      ['ausente', undefined],
      [
        'sem organizações',
        { syncedAt: new Date().toISOString(), organizations: [] },
      ],
      [
        'data inválida',
        { syncedAt: 'ontem', organizations: [{ id: 1, name: 'x' }] },
      ],
      [
        'organização inválida',
        {
          syncedAt: new Date().toISOString(),
          organizations: [{ id: 0, name: '' }],
        },
      ],
      ['texto', '<html>'],
    ])('cadastro %s não é um cadastro: devolve null', async (_case, stored) => {
      cache.get.mockResolvedValue(stored);

      await expect(directory.read()).resolves.toBeNull();
    });
  });

  describe('sync', () => {
    it('lê o cadastro inteiro em páginas, pelo que o portal entrega, e o guarda por sete dias', async () => {
      const everything = ghgOrganizationFactory.buildMany(1200);
      portalWith(everything);

      const snapshot = await directory.sync(context);

      expect(snapshot.organizations).toEqual(everything);
      expect(searches().map((r) => (r.body as PageRequest).skipCount)).toEqual([
        0, 500, 1000,
      ]);
      expect(cache.set).toHaveBeenCalledOnce();
      expect(cache.set).toHaveBeenCalledWith(
        key,
        snapshot,
        GHG_ORGANIZATIONS_TTL_SECONDS,
      );
      expect(GHG_ORGANIZATIONS_TTL_SECONDS).toBe(7 * 86_400);
      expect(Date.parse(snapshot.syncedAt)).toBeGreaterThan(Date.now() - 5_000);
    });

    it('pede a busca paginada por POST, no tamanho de página combinado, sem CNPJ e com o contexto do job', async () => {
      portalWith(ghgOrganizationFactory.buildMany(3));

      await directory.sync(context);

      const [first] = searches();
      expect(first).toMatchObject({
        slug: 'GHG_PROTOCOL',
        context,
        body: { maxResultCount: GHG_ORGANIZATIONS_PAGE_SIZE, skipCount: 0 },
      });
      expect(first.segments.at(-1)).toBe('SearchAllOrganizations');
      expect(first.cnpj).toBeUndefined();
      expect(
        first.resolveBaseUrl?.('https://registropublicodeemissoes.fgv.br'),
      ).toContain('registropublicodeemissoesapi');
      expect(first.budgetMs).toBeLessThanOrEqual(GHG_SYNC_BUDGET_MS);
    });

    it('avança pelo que chegou, não pelo que pediu', async () => {
      portalWith(ghgOrganizationFactory.buildMany(5), 2);

      const snapshot = await directory.sync(context);

      expect(snapshot.organizations).toHaveLength(5);
      expect(searches().map((r) => (r.body as PageRequest).skipCount)).toEqual([
        0, 2, 4,
      ]);
    });

    it('a mesma organização em duas páginas vale uma só', async () => {
      const repeated = ghgOrganizationFactory.build();
      const pages = [
        [repeated, ...ghgOrganizationFactory.buildMany(1)],
        [repeated, ...ghgOrganizationFactory.buildMany(1)],
      ];
      request.execute.mockImplementation((r) =>
        Promise.resolve(
          answer(
            ghgEnvelope({
              total: 4,
              organizations: pages[(r.body as PageRequest).skipCount / 2],
            }),
          ),
        ),
      );

      const snapshot = await directory.sync(context);

      expect(snapshot.organizations).toHaveLength(3);
    });

    describe('o cadastro anterior só é substituído por um cadastro completo', () => {
      it('página vazia antes do total: nada é gravado', async () => {
        request.execute.mockImplementation((r) => {
          const { skipCount } = r.body as PageRequest;

          return Promise.resolve(
            answer(
              ghgOrganizationsPage(ghgOrganizationFactory.buildMany(4), {
                maxResultCount: skipCount === 0 ? 2 : 0,
                skipCount,
              }),
            ),
          );
        });

        await expect(directory.sync(context)).rejects.toThrow(
          GhgOrganizationsUnavailableError,
        );

        expect(searches()).toHaveLength(2);
        expect(cache.set).not.toHaveBeenCalled();
      });

      it('cadastro vazio não é um cadastro', async () => {
        portalWith([]);

        await expect(directory.sync(context)).rejects.toThrow(
          GhgOrganizationsUnavailableError,
        );

        expect(cache.set).not.toHaveBeenCalled();
      });

      // Cadastro de 600: a segunda página (as 100 restantes) é válida e não vazia, de
      // modo que só o status HTTP a distingue de uma resposta boa.
      const sixHundred = ghgOrganizationFactory.buildMany(600);

      it.each([
        ['TIMEOUT', { outcome: 'TIMEOUT' }],
        ['FAILURE', { outcome: 'FAILURE' }],
        ['RATE_LIMITED', { outcome: 'RATE_LIMITED' }],
        ['NOT_FOUND', { outcome: 'NOT_FOUND' }],
        [
          'HTTP 206 com página válida',
          answer(
            ghgOrganizationsPage(sixHundred, {
              maxResultCount: 500,
              skipCount: 500,
            }),
            206,
          ),
        ],
      ])(
        'falha do portal (%s) na segunda página: nada é gravado',
        async (_case, failure) => {
          request.execute
            .mockResolvedValueOnce(
              answer(ghgOrganizationsPage(sixHundred, { maxResultCount: 500 })),
            )
            .mockResolvedValue(failure);

          await expect(directory.sync(context)).rejects.toThrow(
            GhgOrganizationsUnavailableError,
          );

          expect(cache.set).not.toHaveBeenCalled();
        },
      );

      it.each([
        ['texto', answer('<html>')],
        ['sem total', answer(ghgEnvelope({ organizations: [] }))],
        [
          'total acima do teto',
          answer(ghgEnvelope({ total: 20_001, organizations: [] })),
        ],
      ])(
        'resposta fora do contrato (%s): nada é gravado e o motivo não vaza o corpo',
        async (_case, body) => {
          request.execute.mockResolvedValue(body);

          const failure = await directory
            .sync(context)
            .catch((e: unknown) => e);

          expect(failure).toBeInstanceOf(GhgOrganizationsUnavailableError);
          expect((failure as Error).message).not.toContain('html');
          expect(cache.set).not.toHaveBeenCalled();
        },
      );

      it('prazo da sincronização esgotado entre as páginas: nada é gravado', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        request.execute.mockImplementation((r) => {
          vi.setSystemTime(Date.now() + GHG_SYNC_BUDGET_MS + 1);

          return Promise.resolve(
            answer(
              ghgOrganizationsPage(ghgOrganizationFactory.buildMany(600), {
                maxResultCount: 500,
                skipCount: (r.body as PageRequest).skipCount,
              }),
            ),
          );
        });

        await expect(directory.sync(context)).rejects.toThrow(
          GhgOrganizationsUnavailableError,
        );

        expect(searches()).toHaveLength(1);
        expect(cache.set).not.toHaveBeenCalled();
      });
    });

    it('fonte desabilitada: erro próprio, sem chamada', async () => {
      config.execute.mockResolvedValue({ isEnabled: false });

      await expect(directory.sync(context)).rejects.toThrow(
        GhgSourceDisabledError,
      );

      expect(request.execute).not.toHaveBeenCalled();
    });

    it('fonte ausente do catálogo: indisponível, sem chamada', async () => {
      config.execute.mockResolvedValue(null);

      await expect(directory.sync(context)).rejects.toThrow(
        GhgOrganizationsUnavailableError,
      );

      expect(request.execute).not.toHaveBeenCalled();
    });
  });
});
