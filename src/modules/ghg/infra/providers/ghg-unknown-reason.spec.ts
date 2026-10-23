import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { MockInstance } from 'vitest';
import { RequestTrigger } from '@prisma/client';
import type { DataSourceRequest } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { ResolveSourceRequestConfigUseCase } from '@modules/data-sources/infra/usecases/request/resolve-source-request-config.usecase.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import {
  ghgEnvelope,
  ghgInventoryFactory,
} from '@test/factories/ghg/ghg.factory.js';
import { faker } from '@test/support/faker.js';
import {
  GhgOrganizationDirectory,
  GhgOrganizationsUnavailableError,
  GhgSourceDisabledError,
} from './ghg-organization-directory.provider.js';
import { GhgReportReader } from './ghg-report-reader.provider.js';
import { GhgDataSource } from './ghg.data-source.js';
import { UnknownReason } from '@modules/data-sources/domain/unknown-reason.js';

/** Cada UNKNOWN do GHG registra um motivo de um conjunto fechado, sem segredo (#255). */
describe('motivos de UNKNOWN do GHG', () => {
  const request = {
    execute: vi.fn<(request: DataSourceRequest) => Promise<unknown>>(),
  };
  const config = { execute: vi.fn() };
  const ttl = { execute: vi.fn() };
  const cache = { get: vi.fn(), set: vi.fn() };
  const reader = { read: vi.fn() };
  const directory = { read: vi.fn(), sync: vi.fn() };
  const inventory = ghgInventoryFactory.build();
  const name = faker.company.name();
  const context = { trigger: RequestTrigger.ON_DEMAND_JOB };
  // restoreMocks desfaz os espiões a cada teste: eles são recriados no beforeEach.
  let warn: MockInstance<Logger['warn']>;
  let error: MockInstance<Logger['error']>;
  let adapter: GhgDataSource;
  const answer = (body: unknown, status = 200) => ({
    outcome: 'SUCCESS',
    status,
    body,
  });
  const inventories = () =>
    answer(
      ghgEnvelope({
        inventories: [{ year: inventory.year, cycleId: inventory.cycleId }],
        errorMsg: null,
        warnMsg: null,
      }),
    );
  const reasons = () =>
    warn.mock.calls.map(([entry]) => (entry as { reason: string }).reason);
  const run = (names: string[] = [name], cnpj = inventory.cnpj) =>
    adapter.fetch({ cnpj, names }, context);

  beforeEach(async () => {
    vi.resetAllMocks();
    warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    config.execute.mockResolvedValue({
      isEnabled: true,
      requestTimeoutMs: 10000,
    });
    ttl.execute.mockResolvedValue(2592000);
    cache.get.mockResolvedValue(null);
    directory.read.mockResolvedValue({
      syncedAt: new Date().toISOString(),
      organizations: [{ id: inventory.organizationId, name }],
    });
    request.execute.mockImplementation((r) =>
      Promise.resolve(r.download ? answer({}) : inventories()),
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
        { provide: GhgOrganizationDirectory, useValue: directory },
      ],
    }).compile();
    adapter = module.get(GhgDataSource);
  });

  it('coleta bem-sucedida não registra UNKNOWN', async () => {
    await expect(run()).resolves.toMatchObject({ status: 'FOUND' });

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('CNPJ inválido: INVALID_INPUT', async () => {
    await run([name], '123');

    expect(reasons()).toEqual(['INVALID_INPUT']);
  });

  it('fonte fora do catálogo: SOURCE_NOT_CONFIGURED', async () => {
    config.execute.mockResolvedValue(null);

    await run();

    expect(reasons()).toEqual(['SOURCE_NOT_CONFIGURED']);
  });

  it('fonte desabilitada: SOURCE_DISABLED', async () => {
    config.execute.mockResolvedValue({ isEnabled: false });

    await run();

    expect(reasons()).toEqual(['SOURCE_DISABLED']);
  });

  it('sem nome de busca utilizável: INVALID_INPUT', async () => {
    await run(['ab']);

    expect(reasons()).toEqual(['INVALID_INPUT']);
  });

  it('nenhuma organização candidata confirmada: NO_CONFIRMED_MATCH', async () => {
    directory.read.mockResolvedValue({
      syncedAt: new Date().toISOString(),
      organizations: [{ id: 1, name: 'OUTRA EMPRESA DISTINTA' }],
    });

    await run();

    expect(reasons()).toEqual(['NO_CONFIRMED_MATCH']);
  });

  it.each([
    [{ outcome: 'FAILURE', status: 503, message: 'HTTP 503' }, 'SOURCE_ERROR'],
    [{ outcome: 'TIMEOUT', message: 'prazo' }, 'TIMEOUT'],
    [{ outcome: 'RATE_LIMITED', status: 429, message: 'x' }, 'RATE_LIMITED'],
    [answer({}, 206), 'UNEXPECTED_STATUS'],
  ] as const)('portal responde %j: %s', async (response, reason) => {
    request.execute.mockResolvedValue(response);

    await run();

    expect(reasons()).toEqual([reason]);
  });

  it('prazo da coleta esgotado antes da chamada: TIMEOUT', async () => {
    config.execute.mockResolvedValue({ isEnabled: true, requestTimeoutMs: 0 });

    await run();

    expect(reasons()).toEqual(['TIMEOUT']);
  });

  it('lista de inventários fora do formato: CONTRACT_MISMATCH', async () => {
    request.execute.mockResolvedValue(answer({ outro: 'formato' }));

    await run();

    expect(reasons()).toEqual(['CONTRACT_MISMATCH']);
  });

  it.each([
    ['relatório ilegível', null],
    [
      'ano diferente do inventário',
      { cnpj: inventory.cnpj, year: inventory.year - 1 },
    ],
  ])('%s: CONTRACT_MISMATCH', async (_case, identity) => {
    reader.read.mockResolvedValue(identity);

    await run();

    expect(reasons()).toEqual(['CONTRACT_MISMATCH']);
  });

  it.each([
    [new GhgSourceDisabledError(), 'SOURCE_DISABLED'],
    [
      new GhgOrganizationsUnavailableError('x', UnknownReason.TIMEOUT),
      'TIMEOUT',
    ],
    [new GhgOrganizationsUnavailableError('x'), 'SOURCE_ERROR'],
  ])('sincronização do cadastro falha (%s): %s', async (failure, reason) => {
    directory.read.mockResolvedValue(null);
    directory.sync.mockRejectedValue(failure);

    await run();

    expect(reasons()).toEqual([reason]);
  });

  it('erro de programa: UNEXPECTED_ERROR visível como erro, sem a mensagem', async () => {
    const secret = faker.string.alphanumeric(40);
    request.execute.mockRejectedValue(new TypeError(secret));

    await run();

    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'UNEXPECTED_ERROR',
        error: 'TypeError',
      }),
      expect.any(String),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain(secret);
  });
});
