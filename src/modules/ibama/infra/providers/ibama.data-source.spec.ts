import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { Test } from '@nestjs/testing';
import { RequestTrigger } from '@prisma/client';
import {
  type DataSourceRequest,
  type SourceCallContext,
  SourceOutcome,
  type SourceResponse,
} from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { UnknownDataSourceError } from '@modules/data-sources/domain/dtos/errors/unknown-data-source.error.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { faker } from '@test/support/faker.js';
import { IBAMA_RESOURCES, IbamaResource } from '../../domain/ibama-resource.js';
import { FileIbamaDump } from './file-ibama-dump.js';
import {
  IBAMA_SLUG,
  IbamaDataSource,
  MAX_DUMP_BYTES,
} from './ibama.data-source.js';

describe('IbamaDataSource', () => {
  const requestDataSource = {
    execute: vi.fn<RequestDataSourceUseCase['execute']>(),
  };
  let dataSource: IbamaDataSource;
  const context: SourceCallContext = { trigger: RequestTrigger.SCHEDULED_JOB };
  const checksum = faker.string.hexadecimal({
    length: 64,
    prefix: '',
    casing: 'lower',
  });
  const dumps: FileIbamaDump[] = [];
  let lastRequest: DataSourceRequest;

  /** A infraestrutura comum respondendo sucesso: o arquivo que ela diz ter baixado. */
  function succeed(overrides: Record<string, unknown> = {}) {
    requestDataSource.execute.mockImplementation((request) => {
      lastRequest = request;

      return Promise.resolve<SourceResponse>({
        outcome: SourceOutcome.SUCCESS,
        status: 200,
        body: {
          path: request.download?.destination,
          bytes: 1_234,
          checksum,
          ...overrides,
        },
      });
    });
  }

  function respond(response: SourceResponse) {
    requestDataSource.execute.mockImplementation((request) => {
      lastRequest = request;

      return Promise.resolve(response);
    });
  }

  beforeEach(async () => {
    requestDataSource.execute.mockReset();

    const moduleRef = await Test.createTestingModule({
      providers: [
        IbamaDataSource,
        { provide: RequestDataSourceUseCase, useValue: requestDataSource },
      ],
    }).compile();

    dataSource = moduleRef.get(IbamaDataSource);
  });

  afterEach(async () => {
    await Promise.all(dumps.splice(0).map((dump) => dump.dispose()));
  });

  it('declara o slug do catálogo', () => {
    expect(dataSource.slug).toBe(IBAMA_SLUG);
    expect(IBAMA_SLUG).toBe('IBAMA');
  });

  describe.each(Object.values(IbamaResource))('%s', (resource) => {
    const definition = IBAMA_RESOURCES[resource];

    it('pede o arquivo do recurso à infraestrutura comum, em modo de download', async () => {
      succeed();

      const result = await dataSource.download(resource, context);
      if (result.status === 'FOUND') dumps.push(result.data as FileIbamaDump);

      expect(lastRequest).toMatchObject({
        slug: 'IBAMA',
        segments: definition.segments,
        context,
        download: { maxBytes: MAX_DUMP_BYTES },
      });
      expect(lastRequest.download?.destination).toEqual(expect.any(String));
    });

    it('entrega o dump com o checksum e o tamanho do arquivo baixado', async () => {
      succeed();

      const result = await dataSource.download(resource, context);

      expect(result.status).toBe('FOUND');
      if (result.status !== 'FOUND') return;
      dumps.push(result.data as FileIbamaDump);
      expect(result.data).toMatchObject({
        resource,
        checksum,
        bytes: 1_234,
      });
    });
  });

  it('baixa para uma pasta temporária própria de cada chamada', async () => {
    succeed();

    const first = await dataSource.download(
      IbamaResource.TERMO_EMBARGO,
      context,
    );
    const firstDestination = lastRequest.download?.destination;
    const second = await dataSource.download(
      IbamaResource.TERMO_EMBARGO,
      context,
    );
    for (const result of [first, second]) {
      if (result.status === 'FOUND') dumps.push(result.data as FileIbamaDump);
    }

    expect(dirname(firstDestination ?? '')).not.toBe(
      dirname(lastRequest.download?.destination ?? ''),
    );
    expect(existsSync(dirname(firstDestination ?? ''))).toBe(true);
  });

  it('dispose do dump apaga a pasta temporária', async () => {
    succeed();

    const result = await dataSource.download(
      IbamaResource.TERMO_EMBARGO,
      context,
    );
    const directory = dirname(lastRequest.download?.destination ?? '');
    expect(existsSync(directory)).toBe(true);

    if (result.status === 'FOUND') await result.data.dispose();

    expect(existsSync(directory)).toBe(false);
  });

  describe('a fonte não entregou o dump', () => {
    it.each([
      [SourceOutcome.FAILURE, 'HTTP 500'],
      [SourceOutcome.TIMEOUT, 'tempo máximo da chamada esgotado'],
      [SourceOutcome.RATE_LIMITED, 'limite atingido'],
    ] as const)(
      '%s vira UNAVAILABLE com o motivo, e a pasta temporária some',
      async (outcome, message) => {
        respond({ outcome, message });

        const result = await dataSource.download(
          IbamaResource.AUTO_INFRACAO,
          context,
        );

        expect(result).toEqual({
          status: 'UNAVAILABLE',
          reason: outcome,
          message,
        });
        expect(
          existsSync(dirname(lastRequest.download?.destination ?? '')),
        ).toBe(false);
      },
    );

    it('fonte desabilitada no catálogo: UNAVAILABLE (DISABLED), sem pasta sobrando', async () => {
      respond({ outcome: SourceOutcome.DISABLED });

      const result = await dataSource.download(
        IbamaResource.AUTO_INFRACAO,
        context,
      );

      expect(result).toEqual({
        status: 'UNAVAILABLE',
        reason: SourceOutcome.DISABLED,
      });
      expect(existsSync(dirname(lastRequest.download?.destination ?? ''))).toBe(
        false,
      );
    });

    it('404 não é "sem registro": é o dump fora do lugar, e vira UNAVAILABLE', async () => {
      respond({ outcome: SourceOutcome.NOT_FOUND, status: 404 });

      const result = await dataSource.download(
        IbamaResource.AUTO_INFRACAO,
        context,
      );

      expect(result).toMatchObject({
        status: 'UNAVAILABLE',
        reason: SourceOutcome.FAILURE,
        message: expect.stringContaining('base_url'),
      });
      expect(result.status).not.toBe('NOT_FOUND');
      expect(existsSync(dirname(lastRequest.download?.destination ?? ''))).toBe(
        false,
      );
    });

    it('a mensagem do 404 diz qual arquivo faltou', async () => {
      respond({ outcome: SourceOutcome.NOT_FOUND, status: 404 });

      const result = await dataSource.download(
        IbamaResource.TERMO_EMBARGO,
        context,
      );

      expect(result).toMatchObject({
        message: expect.stringContaining(
          'TERMOS_DE_EMBARGO/TERMO_EMBARGO/termo_de_embargo.csv',
        ),
      });
    });
  });

  describe('resposta de sucesso fora do contrato', () => {
    it.each([
      ['checksum que não é SHA-256', { checksum: 'abc' }],
      ['tamanho zero', { bytes: 0 }],
      ['tamanho que não é número', { bytes: 'grande' }],
      ['caminho de outro arquivo', { path: '/etc/passwd' }],
      ['sem caminho', { path: undefined }],
    ])(
      '%s é recusada como UNAVAILABLE, sem sobrar pasta',
      async (_caso, override) => {
        succeed(override);

        const result = await dataSource.download(
          IbamaResource.AUTO_INFRACAO,
          context,
        );

        expect(result).toMatchObject({
          status: 'UNAVAILABLE',
          reason: SourceOutcome.FAILURE,
        });
        expect(
          existsSync(dirname(lastRequest.download?.destination ?? '')),
        ).toBe(false);
      },
    );

    it('corpo que não é um objeto também', async () => {
      respond({ outcome: SourceOutcome.SUCCESS, status: 200, body: 'texto' });

      await expect(
        dataSource.download(IbamaResource.AUTO_INFRACAO, context),
      ).resolves.toMatchObject({ status: 'UNAVAILABLE' });
    });
  });

  it('propaga o erro de programação (fonte fora do catálogo) e limpa a pasta', async () => {
    requestDataSource.execute.mockImplementation((request) => {
      lastRequest = request;

      return Promise.reject(new UnknownDataSourceError('IBAMA'));
    });

    await expect(
      dataSource.download(IbamaResource.AUTO_INFRACAO, context),
    ).rejects.toBeInstanceOf(UnknownDataSourceError);

    expect(existsSync(dirname(lastRequest.download?.destination ?? ''))).toBe(
      false,
    );
  });
});
