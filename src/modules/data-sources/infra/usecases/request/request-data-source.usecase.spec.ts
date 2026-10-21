import { Test } from '@nestjs/testing';
import { RequestOutcome, RequestTrigger } from '@prisma/client';
import { faker } from '@test/support/faker.js';
import { UnknownDataSourceError } from '../../../domain/dtos/errors/unknown-data-source.error.js';
import {
  type DataSourceRequest,
  type DataSourceRequestConfig,
  SourceOutcome,
} from '../../../domain/dtos/providers/data-source-request.dto.js';
import { DataSourceRequestLogRepository } from '../../../domain/dtos/repositories/data-source-request-log.repository.js';
import { DataSourceRepository } from '../../../domain/dtos/repositories/data-source.repository.js';
import {
  SourceHttpClient,
  type SourceHttpResult,
} from '../../../domain/providers/source-http-client.provider.js';
import { SourceRateLimiter } from '../../../domain/providers/source-rate-limiter.provider.js';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  RequestDataSourceUseCase,
} from './request-data-source.usecase.js';

describe('RequestDataSourceUseCase', () => {
  const dataSourceRepository = {
    findRequestConfig: vi.fn<DataSourceRepository['findRequestConfig']>(),
  };
  const requestLogRepository = {
    record: vi.fn<DataSourceRequestLogRepository['record']>(),
  };
  const rateLimiter = { tryAcquire: vi.fn<SourceRateLimiter['tryAcquire']>() };
  const httpClient = {
    get: vi.fn<SourceHttpClient['get']>(),
    download: vi.fn<SourceHttpClient['download']>(),
  };
  let config: DataSourceRequestConfig;
  let request: DataSourceRequest;
  let useCase: RequestDataSourceUseCase;

  const respond = (result: SourceHttpResult) =>
    httpClient.get.mockResolvedValue(result);

  beforeEach(async () => {
    vi.useFakeTimers({ now: faker.date.recent() });
    config = {
      id: faker.database.mongodbObjectId(),
      slug: 'BRASIL_API',
      baseUrl: 'https://brasilapi.com.br/api/cnpj/v1',
      isEnabled: true,
      rateLimitPerMinute: null,
      requestTimeoutMs: 5_000,
    };
    request = {
      slug: 'BRASIL_API',
      segments: ['11222333000181'],
      cnpj: '11222333000181',
      context: { trigger: RequestTrigger.ON_DEMAND_JOB },
    };
    dataSourceRepository.findRequestConfig.mockResolvedValue(config);
    requestLogRepository.record.mockResolvedValue(undefined);
    rateLimiter.tryAcquire.mockResolvedValue(true);
    respond({ kind: 'RESPONSE', status: 200, json: { ok: true } });

    const moduleRef = await Test.createTestingModule({
      providers: [
        RequestDataSourceUseCase,
        { provide: DataSourceRepository, useValue: dataSourceRepository },
        {
          provide: DataSourceRequestLogRepository,
          useValue: requestLogRepository,
        },
        { provide: SourceRateLimiter, useValue: rateLimiter },
        { provide: SourceHttpClient, useValue: httpClient },
      ],
    }).compile();

    useCase = moduleRef.get(RequestDataSourceUseCase);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('chamada bem-sucedida', () => {
    it('devolve o corpo da fonte', async () => {
      await expect(useCase.execute(request)).resolves.toEqual({
        outcome: SourceOutcome.SUCCESS,
        status: 200,
        body: { ok: true },
      });
    });

    it('chama a URL montada da base do catálogo e dos segmentos, com os cabeçalhos e o tempo da fonte', async () => {
      await useCase.execute({
        ...request,
        query: { a: '1' },
        headers: { 'chave-api-dados': 'segredo' },
      });

      expect(httpClient.get).toHaveBeenCalledWith({
        url: 'https://brasilapi.com.br/api/cnpj/v1/11222333000181?a=1',
        headers: { 'chave-api-dados': 'segredo' },
        timeoutMs: 5_000,
      });
    });

    it('usa o tempo máximo padrão quando a fonte não define o seu', async () => {
      config.requestTimeoutMs = null;

      await useCase.execute(request);

      expect(httpClient.get).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS }),
      );
    });

    it('registra a chamada com origem, CNPJ, status e duração', async () => {
      httpClient.get.mockImplementation(async () => {
        await vi.advanceTimersByTimeAsync(120);

        return { kind: 'RESPONSE', status: 200, json: {} };
      });

      await useCase.execute({
        ...request,
        context: {
          trigger: RequestTrigger.SCHEDULED_JOB,
          ingestionRunId: 'run-1',
        },
      });

      expect(requestLogRepository.record).toHaveBeenCalledWith({
        dataSourceId: config.id,
        ingestionRunId: 'run-1',
        cnpj: '11222333000181',
        trigger: RequestTrigger.SCHEDULED_JOB,
        outcome: RequestOutcome.SUCCESS,
        httpStatus: 200,
        durationMs: 120,
        errorMessage: undefined,
      });
    });
  });

  describe('download de arquivo (dump em lote)', () => {
    const file = {
      path: '/tmp/dump',
      bytes: 1_234,
      checksum: faker.string.hexadecimal({
        length: 64,
        prefix: '',
        casing: 'lower',
      }),
    };
    const downloadRequest: DataSourceRequest = {
      slug: 'IBAMA',
      segments: ['SIFISC', 'auto_infracao.zip'],
      download: { destination: '/tmp/dump', maxBytes: 1_000_000 },
      context: { trigger: RequestTrigger.SCHEDULED_JOB },
    };

    beforeEach(() => {
      config.slug = 'IBAMA';
      config.baseUrl = 'https://dados.ibama.test/dados/';
      httpClient.download.mockResolvedValue({
        kind: 'RESPONSE',
        status: 200,
        file,
      });
    });

    it('baixa pelo cliente de download, e não pelo de consulta, com o destino e o limite pedidos', async () => {
      await useCase.execute(downloadRequest);

      expect(httpClient.download).toHaveBeenCalledWith({
        url: 'https://dados.ibama.test/dados/SIFISC/auto_infracao.zip',
        headers: {},
        timeoutMs: 5_000,
        destination: '/tmp/dump',
        maxBytes: 1_000_000,
      });
      expect(httpClient.get).not.toHaveBeenCalled();
    });

    it('o arquivo baixado é o corpo do sucesso', async () => {
      await expect(useCase.execute(downloadRequest)).resolves.toEqual({
        outcome: SourceOutcome.SUCCESS,
        status: 200,
        body: file,
      });
    });

    it('sem pedir download, a consulta continua pelo cliente de consulta', async () => {
      await useCase.execute(request);

      expect(httpClient.get).toHaveBeenCalledOnce();
      expect(httpClient.download).not.toHaveBeenCalled();
    });

    it('registra o download no log como qualquer outra chamada', async () => {
      await useCase.execute(downloadRequest);

      expect(requestLogRepository.record).toHaveBeenCalledWith(
        expect.objectContaining({
          dataSourceId: config.id,
          trigger: RequestTrigger.SCHEDULED_JOB,
          outcome: RequestOutcome.SUCCESS,
          httpStatus: 200,
        }),
      );
    });

    it('respeita o limite por minuto da fonte', async () => {
      config.rateLimitPerMinute = 1;
      rateLimiter.tryAcquire.mockResolvedValue(false);

      await expect(useCase.execute(downloadRequest)).resolves.toMatchObject({
        outcome: SourceOutcome.RATE_LIMITED,
      });
      expect(httpClient.download).not.toHaveBeenCalled();
    });

    it('fonte desabilitada não é baixada', async () => {
      config.isEnabled = false;

      await expect(useCase.execute(downloadRequest)).resolves.toEqual({
        outcome: SourceOutcome.DISABLED,
      });
      expect(httpClient.download).not.toHaveBeenCalled();
    });

    it.each([
      [{ kind: 'TIMEOUT' }, SourceOutcome.TIMEOUT],
      [{ kind: 'FAILED', message: 'arquivo vazio' }, SourceOutcome.FAILURE],
      [{ kind: 'RESPONSE', status: 500 }, SourceOutcome.FAILURE],
      [{ kind: 'RESPONSE', status: 404 }, SourceOutcome.NOT_FOUND],
    ] as [SourceHttpResult, string][])(
      'o desfecho %o é classificado como %s',
      async (result, outcome) => {
        httpClient.download.mockResolvedValue(result);

        await expect(useCase.execute(downloadRequest)).resolves.toMatchObject({
          outcome,
        });
      },
    );

    it('2xx sem arquivo é FAILURE: não há dump a entregar', async () => {
      httpClient.download.mockResolvedValue({ kind: 'RESPONSE', status: 200 });

      await expect(useCase.execute(downloadRequest)).resolves.toEqual({
        outcome: SourceOutcome.FAILURE,
        status: 200,
        message: 'resposta sem corpo',
      });
    });
  });

  describe('classificação do desfecho', () => {
    it('404 é resposta da fonte, sem registro: NOT_FOUND', async () => {
      respond({ kind: 'RESPONSE', status: 404 });

      await expect(useCase.execute(request)).resolves.toEqual({
        outcome: SourceOutcome.NOT_FOUND,
        status: 404,
      });
      expect(requestLogRepository.record).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: RequestOutcome.NOT_FOUND,
          httpStatus: 404,
        }),
      );
    });

    it('429 da fonte é RATE_LIMITED', async () => {
      respond({ kind: 'RESPONSE', status: 429 });

      await expect(useCase.execute(request)).resolves.toMatchObject({
        outcome: SourceOutcome.RATE_LIMITED,
        status: 429,
      });
    });

    it.each([500, 502, 503, 400, 403, 301])(
      'HTTP %i é FAILURE com o status',
      async (status) => {
        respond({ kind: 'RESPONSE', status });

        await expect(useCase.execute(request)).resolves.toEqual({
          outcome: SourceOutcome.FAILURE,
          status,
          message: `HTTP ${status}`,
        });
      },
    );

    it('2xx sem corpo JSON é FAILURE: não há dado a entregar', async () => {
      respond({ kind: 'RESPONSE', status: 204 });

      await expect(useCase.execute(request)).resolves.toEqual({
        outcome: SourceOutcome.FAILURE,
        status: 204,
        message: 'resposta sem corpo',
      });
    });

    it('tempo esgotado é TIMEOUT', async () => {
      respond({ kind: 'TIMEOUT' });

      await expect(useCase.execute(request)).resolves.toMatchObject({
        outcome: SourceOutcome.TIMEOUT,
      });
      expect(requestLogRepository.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: RequestOutcome.TIMEOUT }),
      );
    });

    it('falha de rede é FAILURE com a mensagem, sem status', async () => {
      respond({ kind: 'FAILED', message: 'fetch failed (ECONNREFUSED)' });

      await expect(useCase.execute(request)).resolves.toEqual({
        outcome: SourceOutcome.FAILURE,
        message: 'fetch failed (ECONNREFUSED)',
      });
      expect(requestLogRepository.record).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: RequestOutcome.FAILURE,
          httpStatus: undefined,
          errorMessage: 'fetch failed (ECONNREFUSED)',
        }),
      );
    });

    it('trunca a mensagem de erro gravada no log, sem truncar a resposta', async () => {
      const long = 'x'.repeat(2_000);
      respond({ kind: 'FAILED', message: long });

      const response = await useCase.execute(request);

      expect(response).toMatchObject({ message: long });
      const [entry] = requestLogRepository.record.mock.calls[0];
      expect(entry.errorMessage).toHaveLength(500);
    });
  });

  describe('fonte desabilitada', () => {
    beforeEach(() => {
      config.isEnabled = false;
    });

    it('responde DISABLED sem chamar a fonte nem consumir o limite', async () => {
      config.rateLimitPerMinute = 10;

      await expect(useCase.execute(request)).resolves.toEqual({
        outcome: SourceOutcome.DISABLED,
      });

      expect(httpClient.get).not.toHaveBeenCalled();
      expect(rateLimiter.tryAcquire).not.toHaveBeenCalled();
    });

    it('não registra no log: não houve chamada', async () => {
      await useCase.execute(request);

      expect(requestLogRepository.record).not.toHaveBeenCalled();
    });
  });

  describe('limite de requisições por minuto', () => {
    beforeEach(() => {
      config.rateLimitPerMinute = 90;
    });

    it('reserva uma chamada no limite da fonte antes de chamá-la', async () => {
      await useCase.execute(request);

      expect(rateLimiter.tryAcquire).toHaveBeenCalledWith('BRASIL_API', 90);
      expect(httpClient.get).toHaveBeenCalledOnce();
    });

    it('com o limite atingido, não chama a fonte: RATE_LIMITED', async () => {
      rateLimiter.tryAcquire.mockResolvedValue(false);

      await expect(useCase.execute(request)).resolves.toEqual({
        outcome: SourceOutcome.RATE_LIMITED,
        message: 'limite de 90 requisições por minuto atingido',
      });

      expect(httpClient.get).not.toHaveBeenCalled();
    });

    it('registra a chamada recusada no log, sem status HTTP', async () => {
      rateLimiter.tryAcquire.mockResolvedValue(false);

      await useCase.execute(request);

      expect(requestLogRepository.record).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: RequestOutcome.RATE_LIMITED,
          httpStatus: undefined,
          durationMs: 0,
        }),
      );
    });

    it('sem contador, não chama a fonte: errar para o lado de não consultar', async () => {
      rateLimiter.tryAcquire.mockRejectedValue(new Error('redis fora'));

      const response = await useCase.execute(request);

      expect(response).toMatchObject({
        outcome: SourceOutcome.FAILURE,
        message: expect.stringContaining('redis fora'),
      });
      expect(httpClient.get).not.toHaveBeenCalled();
    });

    it('trata falha do contador que não é Error', async () => {
      rateLimiter.tryAcquire.mockRejectedValue('texto solto');

      await expect(useCase.execute(request)).resolves.toMatchObject({
        outcome: SourceOutcome.FAILURE,
        message: expect.stringContaining('texto solto'),
      });
    });
  });

  it('fonte sem limite declarado não consulta o contador', async () => {
    config.rateLimitPerMinute = null;

    await useCase.execute(request);

    expect(rateLimiter.tryAcquire).not.toHaveBeenCalled();
  });

  describe('URL da fonte inválida', () => {
    it('responde FAILURE sem chamar nada e registra', async () => {
      config.baseUrl = 'isto não é uma url';

      await expect(useCase.execute(request)).resolves.toMatchObject({
        outcome: SourceOutcome.FAILURE,
        message: expect.stringContaining('URL da fonte inválida'),
      });
      expect(httpClient.get).not.toHaveBeenCalled();
      expect(requestLogRepository.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: RequestOutcome.FAILURE }),
      );
    });
  });

  describe('fonte inexistente', () => {
    it('é erro de programação: lança, em vez de responder', async () => {
      dataSourceRepository.findRequestConfig.mockResolvedValue(null);

      await expect(useCase.execute(request)).rejects.toBeInstanceOf(
        UnknownDataSourceError,
      );
      expect(httpClient.get).not.toHaveBeenCalled();
    });

    it('a mensagem diz qual slug procurou', async () => {
      dataSourceRepository.findRequestConfig.mockResolvedValue(null);

      await expect(useCase.execute(request)).rejects.toThrow(/BRASIL_API/);
    });
  });

  describe('log de requisições', () => {
    it('falha ao gravar o log não perde nem desfaz a chamada', async () => {
      requestLogRepository.record.mockRejectedValue(new Error('banco fora'));

      await expect(useCase.execute(request)).resolves.toMatchObject({
        outcome: SourceOutcome.SUCCESS,
      });
    });

    it('trata falha de log que não é Error', async () => {
      requestLogRepository.record.mockRejectedValue('texto solto');

      await expect(useCase.execute(request)).resolves.toBeDefined();
    });

    it('não grava cabeçalhos: a chave de API da fonte não vai ao log', async () => {
      await useCase.execute({
        ...request,
        headers: { 'chave-api-dados': 'segredo-da-fonte' },
      });

      const [entry] = requestLogRepository.record.mock.calls[0];
      expect(JSON.stringify(entry)).not.toContain('segredo-da-fonte');
    });
  });

  it('propaga a falha do catálogo: indisponível não é "fonte inexistente"', async () => {
    dataSourceRepository.findRequestConfig.mockRejectedValue(
      new Error('banco fora'),
    );

    await expect(useCase.execute(request)).rejects.toThrow('banco fora');
  });
});
