import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { MockInstance } from 'vitest';
import { RequestTrigger } from '@prisma/client';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { ResolveSourceRequestConfigUseCase } from '@modules/data-sources/infra/usecases/request/resolve-source-request-config.usecase.js';
import { cguRowFactory } from '@test/factories/cgu/cgu-sanction.factory.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { faker } from '@test/support/faker.js';
import { CguSanctionsProvider } from './cgu-sanctions.provider.js';

/** Cada UNKNOWN da CGU registra um motivo de um conjunto fechado, sem segredo (#255). */
describe('motivos de UNKNOWN da CGU', () => {
  const request = { execute: vi.fn<RequestDataSourceUseCase['execute']>() };
  const catalog = {
    execute: vi.fn<ResolveSourceRequestConfigUseCase['execute']>(),
  };
  const ttl = { execute: vi.fn<ResolveSourceCacheTtlUseCase['execute']>() };
  const cache = { get: vi.fn(), set: vi.fn() };
  const credential = faker.string.alphanumeric(48);
  const config = { get: vi.fn() };
  const context = { trigger: RequestTrigger.USER_QUERY };
  const cnpj = buildCnpj();
  // restoreMocks desfaz os espiões a cada teste: eles são recriados no beforeEach.
  let warn: MockInstance<Logger['warn']>;
  let error: MockInstance<Logger['error']>;
  let provider: CguSanctionsProvider;
  const success = (body: unknown, status = 200) => ({
    outcome: 'SUCCESS' as const,
    status,
    body,
  });
  const reasons = () =>
    warn.mock.calls.map(([entry]) => (entry as { reason: string }).reason);
  const everythingLogged = () =>
    JSON.stringify([...warn.mock.calls, ...error.mock.calls]);

  beforeEach(async () => {
    vi.resetAllMocks();
    warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    config.get.mockReturnValue(credential);
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
        { provide: RequestDataSourceUseCase, useValue: request },
        { provide: ResolveSourceRequestConfigUseCase, useValue: catalog },
        { provide: ResolveSourceCacheTtlUseCase, useValue: ttl },
        { provide: CacheProvider, useValue: cache },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    provider = module.get(CguSanctionsProvider);
  });

  const run = (query = cnpj) => provider.fetch('CGU_CEIS', query, context);

  it('CNPJ inválido: INVALID_INPUT', async () => {
    await run('123');

    expect(reasons()).toEqual(['INVALID_INPUT']);
  });

  it('sem credencial: CREDENTIAL_MISSING', async () => {
    config.get.mockReturnValue(undefined);

    await run();

    expect(reasons()).toEqual(['CREDENTIAL_MISSING']);
  });

  it('fonte fora do catálogo: SOURCE_NOT_CONFIGURED', async () => {
    catalog.execute.mockResolvedValue(null);

    await run();

    expect(reasons()).toEqual(['SOURCE_NOT_CONFIGURED']);
  });

  it('fonte desabilitada: SOURCE_DISABLED', async () => {
    catalog.execute.mockResolvedValue({
      ...(await catalog.execute('CGU_CEIS'))!,
      isEnabled: false,
    });

    await run();

    expect(reasons()).toEqual(['SOURCE_DISABLED']);
  });

  it.each([
    [
      { outcome: 'FAILURE', status: 401, message: 'HTTP 401' },
      'CREDENTIAL_REJECTED',
    ],
    [
      { outcome: 'FAILURE', status: 403, message: 'HTTP 403' },
      'CREDENTIAL_REJECTED',
    ],
    [
      { outcome: 'RATE_LIMITED', status: 429, message: 'HTTP 429' },
      'RATE_LIMITED',
    ],
    [{ outcome: 'TIMEOUT', message: 'prazo' }, 'TIMEOUT'],
    [{ outcome: 'NOT_FOUND', status: 404 }, 'ENDPOINT_NOT_FOUND'],
    [{ outcome: 'FAILURE', status: 503, message: 'HTTP 503' }, 'SOURCE_ERROR'],
  ] as const)('resposta %j: %s', async (response, reason) => {
    request.execute.mockResolvedValue(response);

    await run();

    expect(reasons()).toEqual([reason]);
  });

  it('2xx diferente de 200: UNEXPECTED_STATUS', async () => {
    request.execute.mockResolvedValue(success([], 206));

    await run();

    expect(reasons()).toEqual(['UNEXPECTED_STATUS']);
  });

  it('página fora do formato: CONTRACT_MISMATCH', async () => {
    request.execute.mockResolvedValue(success({ erro: 'novo formato' }));

    await run();

    expect(reasons()).toEqual(['CONTRACT_MISMATCH']);
  });

  it('página repetida: PAGINATION_LIMIT', async () => {
    const row = cguRowFactory.build({
      sancionado: { codigoFormatado: cnpj, nome: faker.person.fullName() },
    });
    request.execute.mockResolvedValue(success([row]));

    await run();

    expect(reasons()).toEqual(['PAGINATION_LIMIT']);
  });

  it('erro de programa: UNEXPECTED_ERROR visível como erro, sem a mensagem', async () => {
    request.execute.mockRejectedValue(
      new TypeError(`falha com chave ${credential}`),
    );

    await run();

    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'UNEXPECTED_ERROR',
        error: 'TypeError',
      }),
      expect.any(String),
    );
  });

  it('a credencial e o cabeçalho nunca aparecem no log, em nenhum motivo', async () => {
    const failures = [
      { outcome: 'FAILURE', status: 401, message: `HTTP 401 ${credential}` },
      { outcome: 'RATE_LIMITED', status: 429, message: credential },
      { outcome: 'TIMEOUT', message: credential },
    ] as const;

    for (const response of failures) {
      request.execute.mockResolvedValue(response);
      await run();
    }
    request.execute.mockRejectedValue(new Error(credential));
    await run();

    expect(everythingLogged()).not.toContain(credential);
    expect(everythingLogged()).not.toContain('chave-api-dados');
    expect(everythingLogged()).not.toContain(cnpj);
  });
});
