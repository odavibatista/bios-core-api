import { Test } from '@nestjs/testing';
import { RequestTrigger } from '@prisma/client';
import type { DataSourceRequest } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import {
  ghgEnvelope,
  ghgInventoryFactory,
} from '@test/factories/ghg/ghg.factory.js';
import { otherCguCnpj } from '@test/factories/cgu/cgu-sanction.factory.js';
import { faker } from '@test/support/faker.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { ResolveSourceRequestConfigUseCase } from '@modules/data-sources/infra/usecases/request/resolve-source-request-config.usecase.js';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { GhgReportReader } from './ghg-report-reader.provider.js';
import { GhgDataSource } from './ghg.data-source.js';
describe('GhgDataSource', () => {
  const request = {
      execute: vi.fn<(request: DataSourceRequest) => Promise<unknown>>(),
    },
    config = { execute: vi.fn() },
    ttl = { execute: vi.fn() },
    cache = { get: vi.fn(), set: vi.fn() },
    reader = { read: vi.fn() };
  const inventory = ghgInventoryFactory.build(),
    name = faker.company.name();
  const context = { trigger: RequestTrigger.ON_DEMAND_JOB };
  let adapter: GhgDataSource;
  const answer = (body: unknown, status = 200) => ({
    outcome: 'SUCCESS',
    status,
    body,
  });
  const run = () =>
    adapter.fetch({ cnpj: inventory.cnpj, names: [name] }, context);
  beforeEach(async () => {
    vi.resetAllMocks();
    config.execute.mockResolvedValue({
      isEnabled: true,
      requestTimeoutMs: 10000,
    });
    ttl.execute.mockResolvedValue(2592000);
    cache.get.mockResolvedValue(null);
    request.execute.mockImplementation((r) =>
      Promise.resolve(
        r.download
          ? answer({})
          : r.segments.at(-1) === 'GetAllOrganizations'
            ? answer(ghgEnvelope([{ id: inventory.organizationId, name }]))
            : answer(
                ghgEnvelope({
                  inventories: [
                    { year: inventory.year, cycleId: inventory.cycleId },
                  ],
                  errorMsg: null,
                  warnMsg: null,
                }),
              ),
      ),
    );
    reader.read.mockResolvedValue({
      cnpj: inventory.cnpj,
      year: inventory.year,
    });
    const module = await Test.createTestingModule({
      providers: [
        GhgDataSource,
        { provide: RequestDataSourceUseCase, useValue: request },
        { provide: ResolveSourceRequestConfigUseCase, useValue: config },
        { provide: ResolveSourceCacheTtlUseCase, useValue: ttl },
        { provide: CacheProvider, useValue: cache },
        { provide: GhgReportReader, useValue: reader },
      ],
    }).compile();
    adapter = module.get(GhgDataSource);
  });
  it('confirma somente CNPJ e ano exatos, cache sanitizado e chamadas auditaveis', async () => {
    const result = await run();
    expect(result.status).toBe('FOUND');
    expect(cache.set).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: inventory.cnpj }),
      expect.objectContaining({ inventories: [inventory] }),
      2592000,
    );
    expect(request.execute).toHaveBeenCalledTimes(3);
    for (const [r] of request.execute.mock.calls) {
      expect(r).toMatchObject({
        slug: 'GHG_PROTOCOL',
        cnpj: inventory.cnpj,
        context,
        budgetMs: expect.any(Number),
      });
      expect(
        r.resolveBaseUrl?.('https://registropublicodeemissoes.fgv.br'),
      ).toContain('registropublicodeemissoesapi');
    }
  });
  it('reutiliza cache com data original sem rede', async () => {
    const collectedAt = new Date(Date.now() - 1000).toISOString();
    cache.get.mockResolvedValue({ collectedAt, inventories: [inventory] });
    expect(await run()).toMatchObject({
      status: 'FOUND',
      data: { collectedAt: new Date(collectedAt) },
    });
    expect(request.execute).not.toHaveBeenCalled();
  });
  it.each([-1000, 2592001 * 1000])(
    'ignora cache futuro ou vencido %s',
    async (age) => {
      cache.get.mockResolvedValue({
        collectedAt: new Date(Date.now() - age).toISOString(),
        inventories: [inventory],
      });
      await run();
      expect(request.execute).toHaveBeenCalledTimes(3);
    },
  );
  it('ignora cache de outra empresa', async () => {
    cache.get.mockResolvedValue({
      collectedAt: new Date().toISOString(),
      inventories: [{ ...inventory, cnpj: otherCguCnpj(inventory.cnpj) }],
    });
    await run();
    expect(request.execute).toHaveBeenCalledTimes(3);
  });
  it.each([null, { isEnabled: false }])(
    'fonte ausente/desabilitada nao consulta cache/rede',
    async (s) => {
      config.execute.mockResolvedValue(s);
      expect((await run()).status).toBe('UNAVAILABLE');
      expect(cache.get).not.toHaveBeenCalled();
      expect(request.execute).not.toHaveBeenCalled();
    },
  );
  it('entrada invalida nao consulta catalogo', async () => {
    expect(
      (await adapter.fetch({ cnpj: 'invalid', names: [name] }, context)).status,
    ).toBe('UNAVAILABLE');
    expect(config.execute).not.toHaveBeenCalled();
  });
  it('sem nome local nao tenta atribuir por coincidencia', async () => {
    await adapter.fetch({ cnpj: inventory.cnpj, names: [] }, context);
    expect(request.execute).not.toHaveBeenCalled();
  });
  it.each(['TIMEOUT', 'NOT_FOUND', 'FAILURE', 'RATE_LIMITED', 'DISABLED'])(
    'falha %s nao e ausencia nem cache',
    async (outcome) => {
      request.execute.mockResolvedValue({ outcome });
      expect((await run()).status).toBe('UNAVAILABLE');
      expect(cache.set).not.toHaveBeenCalled();
    },
  );
  it('HTTP parcial nao produz inventario', async () => {
    request.execute.mockResolvedValue(answer({}, 206));
    expect((await run()).status).toBe('UNAVAILABLE');
  });
  it('HTTP206 com catalogo valido tambem e rejeitado', async () => {
    request.execute.mockResolvedValueOnce(
      answer(ghgEnvelope([{ id: inventory.organizationId, name }]), 206),
    );
    expect((await run()).status).toBe('UNAVAILABLE');
    expect(reader.read).not.toHaveBeenCalled();
  });
  it('seleciona o ano mais recente independentemente da ordem recebida', async () => {
    request.execute
      .mockResolvedValueOnce(
        answer(ghgEnvelope([{ id: inventory.organizationId, name }])),
      )
      .mockResolvedValueOnce(
        answer(
          ghgEnvelope({
            inventories: [
              { year: inventory.year - 1, cycleId: inventory.cycleId + 1 },
              { year: inventory.year, cycleId: inventory.cycleId },
            ],
            errorMsg: null,
            warnMsg: null,
          }),
        ),
      )
      .mockResolvedValue(answer({}));
    expect((await run()).status).toBe('FOUND');
    expect(request.execute.mock.calls[2][0].segments).toContain(
      String(inventory.cycleId),
    );
    expect(cache.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ inventories: [inventory] }),
      expect.anything(),
    );
  });
  it('formato invalido nao produz inventario', async () => {
    request.execute.mockResolvedValue(answer('<html>'));
    expect((await run()).status).toBe('UNAVAILABLE');
  });
  it('catalogo sem candidato nao prova ausencia', async () => {
    request.execute.mockResolvedValue(answer(ghgEnvelope([])));
    expect((await run()).status).toBe('UNAVAILABLE');
    expect(cache.set).not.toHaveBeenCalled();
  });
  it('sem inventarios nao prova ausencia', async () => {
    request.execute
      .mockResolvedValueOnce(
        answer(ghgEnvelope([{ id: inventory.organizationId, name }])),
      )
      .mockResolvedValue(
        answer(ghgEnvelope({ inventories: [], errorMsg: null, warnMsg: null })),
      );
    expect((await run()).status).toBe('UNAVAILABLE');
    expect(reader.read).not.toHaveBeenCalled();
  });
  it('falha ao listar inventarios preserva desconhecido', async () => {
    request.execute
      .mockResolvedValueOnce(
        answer(ghgEnvelope([{ id: inventory.organizationId, name }])),
      )
      .mockResolvedValue({ outcome: 'TIMEOUT' });
    expect((await run()).status).toBe('UNAVAILABLE');
  });
  it('falha no download nao chama parser', async () => {
    request.execute
      .mockResolvedValueOnce(
        answer(ghgEnvelope([{ id: inventory.organizationId, name }])),
      )
      .mockResolvedValueOnce(
        answer(
          ghgEnvelope({
            inventories: [inventory],
            errorMsg: null,
            warnMsg: null,
          }),
        ),
      )
      .mockResolvedValue({ outcome: 'FAILURE' });
    expect((await run()).status).toBe('UNAVAILABLE');
    expect(reader.read).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { ...inventory, year: 2019 },
    { ...inventory, cnpj: otherCguCnpj(inventory.cnpj) },
  ])('PDF sem identidade exata nunca confirma %j', async (identity) => {
    reader.read.mockResolvedValue(identity);
    expect((await run()).status).toBe('UNAVAILABLE');
    expect(cache.set).not.toHaveBeenCalled();
  });
  it('prazo total nao se renova por etapa', async () => {
    config.execute.mockResolvedValue({ isEnabled: true, requestTimeoutMs: 1 });
    request.execute.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return answer(ghgEnvelope([{ id: 1, name }]));
    });
    expect((await run()).status).toBe('UNAVAILABLE');
    expect(request.execute).toHaveBeenCalledTimes(1);
  });
  it('timeout padrao e erro de cache falham sem vazar erro', async () => {
    config.execute.mockResolvedValue({
      isEnabled: true,
      requestTimeoutMs: null,
    });
    expect((await run()).status).toBe('FOUND');
    cache.get.mockRejectedValue(new Error(faker.internet.password()));
    expect((await run()).status).toBe('UNAVAILABLE');
  });
});
