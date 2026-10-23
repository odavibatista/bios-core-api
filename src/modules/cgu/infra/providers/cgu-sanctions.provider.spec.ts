import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RequestTrigger } from '@prisma/client';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { ResolveSourceRequestConfigUseCase } from '@modules/data-sources/infra/usecases/request/resolve-source-request-config.usecase.js';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import {
  cguRowFactory,
  otherCguCnpj,
} from '@test/factories/cgu/cgu-sanction.factory.js';
import { faker } from '@test/support/faker.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { readCguPage } from '../../domain/cgu-sanction.js';
import {
  CguSanctionsProvider,
  CGU_MAX_PAGES,
} from './cgu-sanctions.provider.js';
import { CeisDataSource } from './ceis.data-source.js';
import { CnepDataSource } from './cnep.data-source.js';

describe('adapters CGU', () => {
  const request = { execute: vi.fn<RequestDataSourceUseCase['execute']>() };
  const catalog = {
    execute: vi.fn<ResolveSourceRequestConfigUseCase['execute']>(),
  };
  const ttl = { execute: vi.fn<ResolveSourceCacheTtlUseCase['execute']>() };
  const cache = { get: vi.fn(), set: vi.fn() };
  const token = faker.string.uuid();
  const config = { get: vi.fn().mockReturnValue(token) };
  const context = { trigger: RequestTrigger.USER_QUERY };
  const cnpj = buildCnpj();
  const row = cguRowFactory.build({
    sancionado: { codigoFormatado: cnpj, nome: faker.person.fullName() },
  });
  let provider: CguSanctionsProvider;
  let ceis: CeisDataSource;
  let cnep: CnepDataSource;
  const success = (body: unknown) => ({
    outcome: 'SUCCESS' as const,
    status: 200,
    body,
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    config.get.mockReturnValue(token);
    catalog.execute.mockResolvedValue({
      id: faker.database.mongodbObjectId(),
      slug: 'CGU_CEIS',
      baseUrl: faker.internet.url(),
      isEnabled: true,
      rateLimitPerMinute: 90,
      requestTimeoutMs: 5000,
    });
    ttl.execute.mockResolvedValue(86400);
    cache.get.mockResolvedValue(undefined);
    cache.set.mockResolvedValue(undefined);
    request.execute.mockResolvedValue(success([]));
    const module = await Test.createTestingModule({
      providers: [
        CguSanctionsProvider,
        CeisDataSource,
        CnepDataSource,
        { provide: RequestDataSourceUseCase, useValue: request },
        { provide: ResolveSourceRequestConfigUseCase, useValue: catalog },
        { provide: ResolveSourceCacheTtlUseCase, useValue: ttl },
        { provide: CacheProvider, useValue: cache },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    provider = module.get(CguSanctionsProvider);
    ceis = module.get(CeisDataSource);
    cnep = module.get(CnepDataSource);
  });

  it('lê páginas curtas e página só com CPF até [] e deduplica IDs', async () => {
    const second = cguRowFactory.build({ sancionado: row.sancionado });
    const cpf = cguRowFactory.build({
      sancionado: {
        codigoFormatado: '123.456.789-09',
        nome: faker.person.fullName(),
      },
    });
    request.execute
      .mockResolvedValueOnce(success([row]))
      .mockResolvedValueOnce(success([cpf]))
      .mockResolvedValueOnce(success([row, second]))
      .mockResolvedValueOnce(success([]));
    const result = await ceis.fetch(cnpj, context);
    expect(result).toMatchObject({
      status: 'FOUND',
      data: [
        readCguPage([row], cnpj).sanctions[0],
        readCguPage([second], cnpj).sanctions[0],
      ],
    });
    expect(request.execute).toHaveBeenCalledTimes(4);
    for (let page = 1; page <= 4; page++)
      expect(request.execute).toHaveBeenNthCalledWith(page, {
        slug: 'CGU_CEIS',
        segments: [],
        cnpj,
        context,
        query: { codigoSancionado: cnpj, pagina: String(page) },
        headers: { 'chave-api-dados': token },
        rateLimitGroup: 'CGU',
      });
    expect(JSON.stringify(cache.set.mock.calls)).not.toContain(
      cpf.sancionado.codigoFormatado,
    );
    expect(JSON.stringify(cache.set.mock.calls)).not.toContain(
      row.sancionado.nome,
    );
  });
  it.each(['CGU_CEIS', 'CGU_CNEP'] as const)(
    '%s sem chave nao consulta a fonte nem grava cache',
    async (slug) => {
      config.get.mockReturnValue(undefined);
      const result = await provider.fetch(slug, cnpj, context);
      expect(result).toMatchObject({
        status: 'UNAVAILABLE',
        message: 'credencial ausente',
      });
      expect(request.execute).not.toHaveBeenCalled();
      expect(cache.get).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    },
  );

  it.each(['CGU_CEIS', 'CGU_CNEP'] as const)(
    '%s divide o contador de limite com o outro cadastro (uma chave, um teto)',
    async (slug) => {
      await provider.fetch(slug, cnpj, context);

      expect(request.execute).toHaveBeenCalledWith(
        expect.objectContaining({ slug, rateLimitGroup: 'CGU' }),
      );
    },
  );

  it('limite atingido vira UNAVAILABLE sem repetir a requisição nem gravar cache', async () => {
    request.execute.mockResolvedValue({
      outcome: 'RATE_LIMITED' as const,
      message: 'limite de 90 requisições por minuto atingido',
    });

    await expect(
      provider.fetch('CGU_CEIS', cnpj, context),
    ).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      reason: 'RATE_LIMITED',
    });

    expect(request.execute).toHaveBeenCalledOnce();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('CNEP usa namespace próprio e cache de ausência com TTL do catálogo', async () => {
    await expect(cnep.fetch(cnpj, context)).resolves.toMatchObject({
      status: 'NOT_FOUND',
    });
    expect(request.execute).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'CGU_CNEP' }),
    );
    expect(cache.set).toHaveBeenCalledWith(
      { namespace: CacheNamespace.CGU_CNEP, identifier: cnpj },
      { collectedAt: expect.any(String), sanctions: [] },
      86400,
    );
  });

  it.each([
    { sanctions: [] },
    { sanctions: readCguPage([row], cnpj).sanctions },
  ])(
    'cache válido não renova a data nem consulta a API %#',
    async ({ sanctions }) => {
      const collectedAt = new Date(Date.now() - 30000);
      cache.get.mockResolvedValue({
        collectedAt: collectedAt.toISOString(),
        sanctions,
      });
      const result = await ceis.fetch(cnpj, context);
      expect(result).toMatchObject({
        status: sanctions.length ? 'FOUND' : 'NOT_FOUND',
        collectedAt,
      });
      expect(request.execute).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    },
  );

  it.each(['expired', 'future', 'foreign', 'invalid'])(
    'ignora cache %s',
    async (kind) => {
      const data = readCguPage([row], cnpj).sanctions;
      cache.get.mockResolvedValue(
        kind === 'invalid'
          ? {}
          : {
              collectedAt: new Date(
                Date.now() +
                  (kind === 'future'
                    ? 50000
                    : kind === 'expired'
                      ? -90000000
                      : -10000),
              ).toISOString(),
              sanctions:
                kind === 'foreign'
                  ? [{ ...data[0], cnpj: otherCguCnpj(cnpj) }]
                  : data,
            },
      );
      await ceis.fetch(cnpj, context);
      expect(request.execute).toHaveBeenCalledOnce();
    },
  );

  it.each([
    'TIMEOUT',
    'RATE_LIMITED',
    'FAILURE',
    'DISABLED',
    'NOT_FOUND',
  ] as const)(
    'falha %s após página válida não publica carga parcial',
    async (outcome) => {
      request.execute
        .mockResolvedValueOnce(success([row]))
        .mockResolvedValueOnce(
          outcome === 'DISABLED'
            ? { outcome }
            : outcome === 'NOT_FOUND'
              ? { outcome, status: 404 }
              : { outcome, message: token },
        );
      const result = await ceis.fetch(cnpj, context);
      expect(result).toMatchObject({
        status: 'UNAVAILABLE',
        reason: outcome === 'NOT_FOUND' ? 'FAILURE' : outcome,
      });
      expect(JSON.stringify(result)).not.toContain(token);
      expect(cache.set).not.toHaveBeenCalled();
    },
  );

  it('página repetida não produz retrato truncado', async () => {
    request.execute.mockResolvedValue(success([row]));
    expect((await ceis.fetch(cnpj, context)).status).toBe('UNAVAILABLE');
    expect(request.execute).toHaveBeenCalledTimes(2);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('HTTP 206 não comprova uma resposta completa', async () => {
    request.execute.mockResolvedValue({ ...success([]), status: 206 });
    expect((await ceis.fetch(cnpj, context)).status).toBe('UNAVAILABLE');
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('limita paginação mesmo sem repetição', async () => {
    let id = 0;
    request.execute.mockImplementation(() =>
      Promise.resolve(success([{ ...row, id: ++id }])),
    );
    expect((await ceis.fetch(cnpj, context)).status).toBe('UNAVAILABLE');
    expect(request.execute).toHaveBeenCalledTimes(CGU_MAX_PAGES);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it.each([{}, [{ ...row, dataFimSancao: '31/02/2024' }]])(
    'formato inválido não confirma ausência %#',
    async (body) => {
      request.execute.mockResolvedValue(success(body));
      expect((await ceis.fetch(cnpj, context)).status).toBe('UNAVAILABLE');
      expect(cache.set).not.toHaveBeenCalled();
    },
  );

  it('fonte desabilitada não lê cache nem chama API', async () => {
    const source = await catalog.execute('CGU_CEIS');
    catalog.execute.mockResolvedValue({ ...source!, isEnabled: false });
    expect(await ceis.fetch(cnpj, context)).toMatchObject({
      status: 'UNAVAILABLE',
      reason: 'DISABLED',
    });
    expect(cache.get).not.toHaveBeenCalled();
    expect(request.execute).not.toHaveBeenCalled();
  });

  it('fonte ausente e CNPJ inválido não chamam API', async () => {
    catalog.execute.mockResolvedValue(null);
    expect((await ceis.fetch(cnpj, context)).status).toBe('UNAVAILABLE');
    expect((await provider.fetch('CGU_CEIS', 'inválido', context)).status).toBe(
      'UNAVAILABLE',
    );
    expect(request.execute).not.toHaveBeenCalled();
  });

  it('exceção inesperada não revela a chave', async () => {
    request.execute.mockRejectedValue(new Error(token));
    const result = await ceis.fetch(cnpj, context);
    expect(result.status).toBe('UNAVAILABLE');
    expect(JSON.stringify(result)).not.toContain(token);
  });
});
