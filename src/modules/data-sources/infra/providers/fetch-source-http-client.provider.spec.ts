import {
  FetchSourceHttpClient,
  MAX_RESPONSE_BYTES,
} from './fetch-source-http-client.provider.js';

describe('FetchSourceHttpClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const client = new FetchSourceHttpClient();
  const request = {
    url: 'https://fonte.test/api/cnpj/11222333000181',
    headers: {},
    timeoutMs: 5_000,
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  /** Corpo em fluxo, entregue nos pedaços informados. */
  function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
  }

  describe('resposta 2xx', () => {
    it('devolve o status e o JSON lido', async () => {
      fetchMock.mockResolvedValue(Response.json({ razao_social: 'ACME' }));

      await expect(client.get(request)).resolves.toEqual({
        kind: 'RESPONSE',
        status: 200,
        json: { razao_social: 'ACME' },
      });
    });

    it('lê corpo com acentos mesmo quando um caractere é partido entre pedaços', async () => {
      const bytes = new TextEncoder().encode('{"nome":"AÇÃO"}');
      // Corta no meio do "Ç" (2 bytes em UTF-8).
      const cut = bytes.indexOf(0xc3) + 1;
      fetchMock.mockResolvedValue(
        new Response(streamOf([bytes.slice(0, cut), bytes.slice(cut)])),
      );

      await expect(client.get(request)).resolves.toMatchObject({
        json: { nome: 'AÇÃO' },
      });
    });

    it.each([
      ['corpo vazio', new Response('', { status: 200 })],
      ['só espaços', new Response('  \n ', { status: 200 })],
      ['sem corpo', new Response(null, { status: 204 })],
    ])(
      'sem JSON a entregar (%s): devolve o status sem corpo',
      async (_case, response) => {
        fetchMock.mockResolvedValue(response);

        const result = await client.get(request);

        expect(result).toEqual({ kind: 'RESPONSE', status: response.status });
        expect(result).not.toHaveProperty('json');
      },
    );

    it('JSON inválido é falha, não dado', async () => {
      fetchMock.mockResolvedValue(new Response('<html>erro</html>'));

      await expect(client.get(request)).resolves.toEqual({
        kind: 'FAILED',
        message: 'resposta não é um JSON válido',
      });
    });

    it('aceita JSON que é null, false ou 0', async () => {
      fetchMock.mockResolvedValue(new Response('null'));

      await expect(client.get(request)).resolves.toEqual({
        kind: 'RESPONSE',
        status: 200,
        json: null,
      });
    });
  });

  describe('resposta que não é 2xx', () => {
    it.each([404, 429, 500, 503, 400, 301])(
      'HTTP %i devolve só o status, sem ler o corpo',
      async (status) => {
        const response = new Response('{"erro":true}', { status });
        const cancel = vi.spyOn(response.body!, 'cancel');
        fetchMock.mockResolvedValue(response);

        await expect(client.get(request)).resolves.toEqual({
          kind: 'RESPONSE',
          status,
        });
        expect(cancel).toHaveBeenCalled();
      },
    );

    it('resposta sem corpo também é aceita', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

      await expect(client.get(request)).resolves.toEqual({
        kind: 'RESPONSE',
        status: 404,
      });
    });
  });

  describe('tamanho da resposta', () => {
    it('recusa pelo Content-Length, sem ler o corpo', async () => {
      const response = new Response('{}', {
        headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) },
      });
      const getReader = vi.spyOn(response.body!, 'getReader');
      fetchMock.mockResolvedValue(response);

      await expect(client.get(request)).resolves.toEqual({
        kind: 'FAILED',
        message: 'resposta maior que o limite aceito',
      });
      expect(getReader).not.toHaveBeenCalled();
    });

    it('aborta a leitura quando o fluxo passa do limite, mesmo sem Content-Length', async () => {
      const megabyte = new Uint8Array(1024 * 1024).fill(0x61);
      fetchMock.mockResolvedValue(
        new Response(streamOf(Array.from({ length: 6 }, () => megabyte))),
      );

      await expect(client.get(request)).resolves.toEqual({
        kind: 'FAILED',
        message: 'resposta maior que o limite aceito',
      });
    });

    it('aceita corpo no limite', async () => {
      const text = JSON.stringify({ d: 'x'.repeat(1_000) });
      fetchMock.mockResolvedValue(new Response(text));

      await expect(client.get(request)).resolves.toMatchObject({
        kind: 'RESPONSE',
      });
    });
  });

  describe('falhas', () => {
    it('tempo esgotado é TIMEOUT', async () => {
      fetchMock.mockRejectedValue(
        new DOMException('The operation was aborted', 'TimeoutError'),
      );

      await expect(client.get(request)).resolves.toEqual({ kind: 'TIMEOUT' });
    });

    it('tempo esgotado durante a leitura do corpo também é TIMEOUT', async () => {
      const body = new ReadableStream<Uint8Array>({
        pull() {
          throw new DOMException('timeout', 'TimeoutError');
        },
      });
      fetchMock.mockResolvedValue(new Response(body));

      await expect(client.get(request)).resolves.toEqual({ kind: 'TIMEOUT' });
    });

    it('falha de rede inclui o código da causa', async () => {
      fetchMock.mockRejectedValue(
        new TypeError('fetch failed', {
          cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }),
        }),
      );

      await expect(client.get(request)).resolves.toEqual({
        kind: 'FAILED',
        message: 'fetch failed (ECONNREFUSED)',
      });
    });

    it('falha sem causa traz só a mensagem', async () => {
      fetchMock.mockRejectedValue(new Error('boom'));

      await expect(client.get(request)).resolves.toEqual({
        kind: 'FAILED',
        message: 'boom',
      });
    });

    it('causa que não é Error é ignorada', async () => {
      fetchMock.mockRejectedValue(
        new TypeError('fetch failed', { cause: 'x' }),
      );

      await expect(client.get(request)).resolves.toEqual({
        kind: 'FAILED',
        message: 'fetch failed',
      });
    });

    it('rejeição que não é Error vira texto', async () => {
      fetchMock.mockRejectedValue('texto solto');

      await expect(client.get(request)).resolves.toEqual({
        kind: 'FAILED',
        message: 'texto solto',
      });
    });
  });

  describe('requisição enviada', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(Response.json({}));
    });

    it('é um GET na URL pedida, sem seguir redirecionamentos', async () => {
      await client.get(request);

      expect(fetchMock).toHaveBeenCalledWith(
        request.url,
        expect.objectContaining({ method: 'GET', redirect: 'manual' }),
      );
    });

    it('pede JSON e se identifica', async () => {
      await client.get(request);

      const [, init] = fetchMock.mock.calls[0];
      expect(init?.headers).toEqual({
        accept: 'application/json',
        'user-agent': 'bios-core-api',
      });
    });

    it('acrescenta os cabeçalhos da fonte', async () => {
      await client.get({ ...request, headers: { 'chave-api-dados': 'abc' } });

      const [, init] = fetchMock.mock.calls[0];
      expect(init?.headers).toMatchObject({
        accept: 'application/json',
        'chave-api-dados': 'abc',
      });
    });

    it('amarra a chamada ao tempo máximo da fonte', async () => {
      const timeout = vi.spyOn(AbortSignal, 'timeout');

      await client.get({ ...request, timeoutMs: 1_234 });

      expect(timeout).toHaveBeenCalledWith(1_234);
      const [, init] = fetchMock.mock.calls[0];
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('POST com corpo JSON', () => {
    const body = { maxResultCount: 1000, skipCount: 0 };

    beforeEach(() => {
      fetchMock.mockResolvedValue(Response.json({ total: 1 }));
    });

    it('envia o corpo como JSON, com o tipo de conteúdo, na URL pedida e sem seguir redirecionamentos', async () => {
      await client.post({ ...request, body });

      expect(fetchMock).toHaveBeenCalledWith(
        request.url,
        expect.objectContaining({
          method: 'POST',
          redirect: 'manual',
          body: JSON.stringify(body),
        }),
      );
      const [, init] = fetchMock.mock.calls[0];
      expect(init?.headers).toEqual({
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'bios-core-api',
      });
    });

    it('os cabeçalhos da fonte prevalecem sobre os padrões', async () => {
      await client.post({
        ...request,
        body,
        headers: { 'content-type': 'application/json-patch+json' },
      });

      const [, init] = fetchMock.mock.calls[0];
      expect(init?.headers).toMatchObject({
        'content-type': 'application/json-patch+json',
      });
    });

    it('devolve o status e o JSON lido, com as mesmas garantias do GET', async () => {
      await expect(client.post({ ...request, body })).resolves.toEqual({
        kind: 'RESPONSE',
        status: 200,
        json: { total: 1 },
      });
    });

    it('resposta que não é 2xx traz só o status', async () => {
      fetchMock.mockResolvedValue(new Response('inválido', { status: 400 }));

      await expect(client.post({ ...request, body })).resolves.toEqual({
        kind: 'RESPONSE',
        status: 400,
      });
    });

    it('amarra a chamada ao tempo máximo e nunca lança', async () => {
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      fetchMock.mockRejectedValue(
        Object.assign(new Error('prazo'), { name: 'TimeoutError' }),
      );

      await expect(
        client.post({ ...request, body, timeoutMs: 2_345 }),
      ).resolves.toEqual({ kind: 'TIMEOUT' });

      expect(timeout).toHaveBeenCalledWith(2_345);
    });

    it('o GET não leva corpo nem tipo de conteúdo', async () => {
      await client.get(request);

      const [, init] = fetchMock.mock.calls[0];
      expect(init).not.toHaveProperty('body');
      expect(init?.headers).not.toHaveProperty('content-type');
    });
  });

  describe('download: resposta 2xx sem corpo', () => {
    it('é falha, não um arquivo vazio gravado', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

      await expect(
        client.download({
          ...request,
          destination: 'nao-sera-criado',
          maxBytes: 1_000,
        }),
      ).resolves.toEqual({ kind: 'FAILED', message: 'resposta sem corpo' });
    });
  });
});
