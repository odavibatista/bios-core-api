import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { faker } from '@test/support/faker.js';
import { FetchSourceHttpClient } from './fetch-source-http-client.provider.js';

/**
 * `download` contra um servidor HTTP de verdade: o que importa é o fluxo para o
 * disco, o limite de tamanho, o tempo máximo e a limpeza do arquivo parcial, e
 * nada disso se prova com um `fetch` simulado.
 */
describe('FetchSourceHttpClient.download', () => {
  const client = new FetchSourceHttpClient();
  let server: Server;
  let baseUrl: string;
  let directory: string;
  let destination: string;
  let handler: (request: IncomingMessage, response: ServerResponse) => void;
  const timers: NodeJS.Timeout[] = [];
  const requests: IncomingMessage[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests.push(request);
      handler(request, response);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(async () => {
    requests.length = 0;
    directory = await mkdtemp(join(tmpdir(), 'bios-download-spec-'));
    destination = join(directory, 'dump');
  });

  afterEach(async () => {
    timers.splice(0).forEach(clearTimeout);
    await rm(directory, { recursive: true, force: true });
  });

  function download(
    overrides: Partial<Parameters<typeof client.download>[0]> = {},
  ) {
    return client.download({
      url: `${baseUrl}/dump.zip`,
      headers: {},
      timeoutMs: 5_000,
      destination,
      maxBytes: 10 * 1024 * 1024,
      ...overrides,
    });
  }

  describe('arquivo baixado', () => {
    it('grava o conteúdo, o tamanho e o SHA-256 calculado durante a gravação', async () => {
      const content = faker.string.alphanumeric(200_000);
      handler = (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/zip' });
        response.end(content);
      };

      const result = await download();

      expect(result).toEqual({
        kind: 'RESPONSE',
        status: 200,
        file: {
          path: destination,
          bytes: content.length,
          checksum: createHash('sha256').update(content).digest('hex'),
        },
      });
      expect((await readFile(destination)).toString()).toBe(content);
    });

    it('o checksum muda quando o conteúdo muda (e só então)', async () => {
      const respondWith = (text: string) => {
        handler = (_request, response) => {
          response.writeHead(200).end(text);
        };
      };

      respondWith('dump A');
      const first = await download();
      respondWith('dump A');
      const same = await download();
      respondWith('dump B');
      const other = await download();

      const checksumOf = (result: Awaited<typeof first>) =>
        result.kind === 'RESPONSE' ? result.file?.checksum : undefined;
      expect(checksumOf(same)).toBe(checksumOf(first));
      expect(checksumOf(other)).not.toBe(checksumOf(first));
    });

    it('grava em fluxo, em vários pedaços, sem perder bytes', async () => {
      const chunks = Array.from({ length: 20 }, () =>
        faker.string.alpha(5_000),
      );
      handler = (_request, response) => {
        response.writeHead(200);
        for (const chunk of chunks) response.write(chunk);
        response.end();
      };

      const result = await download();

      expect(result).toMatchObject({
        file: { bytes: 100_000 },
      });
      expect((await readFile(destination)).toString()).toBe(chunks.join(''));
    });

    it('não pede JSON: o dump é um arquivo qualquer', async () => {
      handler = (_request, response) => {
        response.writeHead(200).end('x');
      };

      await download();

      expect(requests[0].headers.accept).toBe('*/*');
    });

    it('envia o User-Agent e os cabeçalhos da fonte', async () => {
      handler = (_request, response) => {
        response.writeHead(200).end('x');
      };

      await download({ headers: { 'x-fonte': 'abc' } });

      expect(requests[0].headers['user-agent']).toBe('bios-core-api');
      expect(requests[0].headers['x-fonte']).toBe('abc');
    });
  });

  describe('a fonte não entregou o arquivo', () => {
    it.each([404, 500, 503])(
      'HTTP %i: só o status, sem arquivo',
      async (status) => {
        handler = (_request, response) => {
          response.writeHead(status).end('erro');
        };

        await expect(download()).resolves.toEqual({
          kind: 'RESPONSE',
          status,
        });
        expect(existsSync(destination)).toBe(false);
      },
    );

    it('não segue redirecionamento (o endereço vem do catálogo)', async () => {
      handler = (_request, response) => {
        response.writeHead(302, { location: `${baseUrl}/outro` }).end();
      };

      await expect(download()).resolves.toEqual({
        kind: 'RESPONSE',
        status: 302,
      });
      expect(requests).toHaveLength(1);
      expect(existsSync(destination)).toBe(false);
    });

    it('corpo vazio é falha, sem arquivo', async () => {
      handler = (_request, response) => {
        response.writeHead(200).end();
      };

      await expect(download()).resolves.toEqual({
        kind: 'FAILED',
        message: 'arquivo vazio',
      });
      expect(existsSync(destination)).toBe(false);
    });

    it('conexão recusada é falha', async () => {
      const closed = createServer();
      await new Promise<void>((resolve) =>
        closed.listen(0, '127.0.0.1', resolve),
      );
      const { port } = closed.address() as AddressInfo;
      await new Promise((resolve) => closed.close(resolve));

      const result = await download({ url: `http://127.0.0.1:${port}/dump` });

      expect(result).toMatchObject({ kind: 'FAILED' });
      expect(existsSync(destination)).toBe(false);
    });
  });

  describe('limite de tamanho', () => {
    it('recusa pelo Content-Length, sem baixar', async () => {
      handler = (_request, response) => {
        response.writeHead(200, { 'content-length': '5000' });
        response.end(faker.string.alpha(5_000));
      };

      await expect(download({ maxBytes: 1_000 })).resolves.toEqual({
        kind: 'FAILED',
        message: 'arquivo maior que o limite aceito',
      });
      expect(existsSync(destination)).toBe(false);
    });

    it('aborta e apaga o que gravou quando o corpo passa do limite sem declarar o tamanho', async () => {
      handler = (_request, response) => {
        // Sem Content-Length (transferência em pedaços): o tamanho só aparece lendo.
        response.writeHead(200);
        for (let i = 0; i < 50; i++) response.write(faker.string.alpha(1_000));
        response.end();
      };

      await expect(download({ maxBytes: 10_000 })).resolves.toEqual({
        kind: 'FAILED',
        message: 'arquivo maior que o limite aceito',
      });
      expect(existsSync(destination)).toBe(false);
    });

    it('aceita o arquivo exatamente do tamanho do limite', async () => {
      handler = (_request, response) => {
        response.writeHead(200).end(faker.string.alpha(1_000));
      };

      await expect(download({ maxBytes: 1_000 })).resolves.toMatchObject({
        kind: 'RESPONSE',
        file: { bytes: 1_000 },
      });
    });
  });

  describe('tempo máximo', () => {
    it('esgotado antes da resposta: TIMEOUT, sem arquivo', async () => {
      handler = () => {
        // Nunca responde.
      };

      await expect(download({ timeoutMs: 150 })).resolves.toEqual({
        kind: 'TIMEOUT',
      });
      expect(existsSync(destination)).toBe(false);
    });

    it('esgotado no meio do corpo: TIMEOUT, e o arquivo parcial é apagado', async () => {
      handler = (_request, response) => {
        response.writeHead(200);
        response.write(faker.string.alpha(10_000));
        // O resto nunca chega.
        timers.push(setTimeout(() => response.end(), 5_000));
      };

      await expect(download({ timeoutMs: 300 })).resolves.toEqual({
        kind: 'TIMEOUT',
      });
      expect(existsSync(destination)).toBe(false);
    });
  });

  it('destino que não pode ser gravado é falha, e não exceção', async () => {
    handler = (_request, response) => {
      response.writeHead(200).end('conteúdo');
    };

    const result = await download({
      destination: join(directory, 'pasta-que-nao-existe', 'dump'),
    });

    expect(result).toMatchObject({ kind: 'FAILED' });
  });
});
