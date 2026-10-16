import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import {
  DataSourceRole,
  IngestionMode,
  RequestOutcome,
  RequestTrigger,
} from '@prisma/client';
import { UnknownDataSourceError } from '@modules/data-sources/domain/dtos/errors/unknown-data-source.error.js';
import { SourceOutcome } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { toLookupResult } from '@modules/data-sources/domain/data-source.interface.js';
import { MAX_RESPONSE_BYTES } from '@modules/data-sources/infra/providers/fetch-source-http-client.provider.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { faker } from '../support/faker.js';
import { resetSourceRateLimits } from '../support/source-rate-limit.js';

const REDIS_URL = inject('testRedisUrl');
const CNPJ = '11222333000181';

/** O que o servidor simulado da fonte recebeu. */
interface ReceivedRequest {
  url: string;
  headers: IncomingMessage['headers'];
}

type Behavior = (
  request: IncomingMessage,
  respond: {
    json: (status: number, body: unknown) => void;
    raw: (
      status: number,
      body: string,
      headers?: Record<string, string>,
    ) => void;
    redirect: (location: string) => void;
    hang: (milliseconds: number) => void;
  },
) => void;

/**
 * Infraestrutura comum das fontes externas contra banco, Redis e HTTP reais
 * (NFPD01): a fonte é um servidor local, cadastrada no catálogo como qualquer
 * outra, e o caso de uso a chama pelo `slug`. Cobre o que um adapter recebe —
 * dado, ausência, falha, tempo esgotado, limite — e o que fica no log.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Chamadas às fontes externas (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let requestSource: RequestDataSourceUseCase;
    let server: Server;
    let baseUrl: string;
    let behavior: Behavior;
    const received: ReceivedRequest[] = [];
    const timers: NodeJS.Timeout[] = [];
    const pendingRedirectHits: string[] = [];

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      requestSource = app.get(RequestDataSourceUseCase, { strict: false });

      server = createServer((request, response) => {
        if (request.url?.startsWith('/alvo-do-redirecionamento')) {
          pendingRedirectHits.push(request.url);
          response.writeHead(200).end('{}');

          return;
        }

        received.push({ url: request.url ?? '', headers: request.headers });
        behavior(request, {
          json: (status, body) =>
            response
              .writeHead(status, { 'content-type': 'application/json' })
              .end(JSON.stringify(body)),
          raw: (status, body, headers = {}) =>
            response.writeHead(status, headers).end(body),
          redirect: (location) => response.writeHead(302, { location }).end(),
          hang: (milliseconds) => {
            timers.push(
              setTimeout(() => response.writeHead(200).end('{}'), milliseconds),
            );
          },
        });
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    beforeEach(async () => {
      received.length = 0;
      pendingRedirectHits.length = 0;
      behavior = (_request, respond) => respond.json(200, { ok: true });
      await resetSourceRateLimits(REDIS_URL);
    });

    afterEach(async () => {
      timers.splice(0).forEach(clearTimeout);
      await prisma.reset(['data_sources', 'data_source_request_logs']);
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await resetSourceRateLimits(REDIS_URL);
      await app.close();
    });

    /** Cadastra uma fonte de teste apontando para o servidor local. */
    async function createSource(
      overrides: Partial<{
        base_url: string;
        is_enabled: boolean;
        rate_limit_per_minute: number;
        request_timeout_ms: number;
      }> = {},
    ): Promise<{ slug: string; id: string }> {
      const slug = `TESTE_${faker.string.alphanumeric(10).toUpperCase()}`;
      const { id_data_source } = await prisma.dataSource.create({
        data: {
          slug,
          name: `Fonte de teste ${slug}`,
          base_url: `${baseUrl}/api/cnpj`,
          role: DataSourceRole.CADASTRAL,
          ingestion_mode: IngestionMode.ON_DEMAND,
          request_timeout_ms: 2_000,
          ...overrides,
        },
      });

      return { slug, id: id_data_source };
    }

    const call = (
      slug: string,
      extra: Partial<Parameters<RequestDataSourceUseCase['execute']>[0]> = {},
    ) =>
      requestSource.execute({
        slug,
        segments: [CNPJ],
        cnpj: CNPJ,
        context: { trigger: RequestTrigger.ON_DEMAND_JOB },
        ...extra,
      });

    const logsOf = (id: string) =>
      prisma.dataSourceRequestLog.findMany({
        where: { data_source_id: id },
        orderBy: { requested_at: 'asc' },
      });

    describe('chamada bem-sucedida', () => {
      it('devolve o JSON da fonte', async () => {
        const { slug } = await createSource();
        behavior = (_r, respond) => respond.json(200, { razao_social: 'ACME' });

        await expect(call(slug)).resolves.toEqual({
          outcome: SourceOutcome.SUCCESS,
          status: 200,
          body: { razao_social: 'ACME' },
        });
      });

      it('monta a URL da base do catálogo com os segmentos e a consulta, e envia os cabeçalhos', async () => {
        const { slug } = await createSource();

        await call(slug, {
          segments: ['v1', CNPJ],
          query: { completo: 'sim' },
          headers: { 'chave-api-dados': 'segredo-da-fonte' },
        });

        expect(received).toHaveLength(1);
        expect(received[0].url).toBe(`/api/cnpj/v1/${CNPJ}?completo=sim`);
        expect(received[0].headers).toMatchObject({
          accept: 'application/json',
          'user-agent': 'bios-core-api',
          'chave-api-dados': 'segredo-da-fonte',
        });
      });

      it('registra a chamada no log, com origem, CNPJ, status e duração', async () => {
        const { slug, id } = await createSource();

        await call(slug, {
          context: { trigger: RequestTrigger.USER_QUERY },
        });

        const [log] = await logsOf(id);
        expect(log).toMatchObject({
          data_source_id: id,
          cnpj: CNPJ,
          trigger: RequestTrigger.USER_QUERY,
          outcome: RequestOutcome.SUCCESS,
          http_status: 200,
        });
        expect(log.duration_ms).toBeGreaterThanOrEqual(0);
        expect(log.requested_at).toBeInstanceOf(Date);
        expect(log.error_message ?? null).toBeNull();
      });

      it('o log não guarda os cabeçalhos: a chave de API da fonte fica fora', async () => {
        const { slug, id } = await createSource();

        await call(slug, {
          headers: { 'chave-api-dados': 'segredo-da-fonte' },
        });

        expect(JSON.stringify(await logsOf(id))).not.toContain(
          'segredo-da-fonte',
        );
      });

      it('o resultado se converte para o do adapter pelo conversor comum', async () => {
        const { slug } = await createSource();
        behavior = (_r, respond) => respond.json(200, { razao_social: 'ACME' });

        const result = toLookupResult(await call(slug), (body) =>
          typeof body === 'object' && body !== null && 'razao_social' in body
            ? String(body.razao_social)
            : null,
        );

        expect(result).toEqual({ status: 'FOUND', data: 'ACME' });
      });
    });

    describe('desfechos que não são dado', () => {
      it('404: NOT_FOUND, uma resposta válida da fonte', async () => {
        const { slug, id } = await createSource();
        behavior = (_r, respond) => respond.json(404, { message: 'nada' });

        await expect(call(slug)).resolves.toEqual({
          outcome: SourceOutcome.NOT_FOUND,
          status: 404,
        });
        expect((await logsOf(id))[0]).toMatchObject({
          outcome: RequestOutcome.NOT_FOUND,
          http_status: 404,
        });
      });

      it('500: FAILURE com o status', async () => {
        const { slug, id } = await createSource();
        behavior = (_r, respond) => respond.json(500, {});

        await expect(call(slug)).resolves.toMatchObject({
          outcome: SourceOutcome.FAILURE,
          status: 500,
        });
        expect((await logsOf(id))[0]).toMatchObject({
          outcome: RequestOutcome.FAILURE,
          http_status: 500,
          error_message: 'HTTP 500',
        });
      });

      it('429 da fonte: RATE_LIMITED', async () => {
        const { slug } = await createSource();
        behavior = (_r, respond) => respond.json(429, {});

        await expect(call(slug)).resolves.toMatchObject({
          outcome: SourceOutcome.RATE_LIMITED,
          status: 429,
        });
      });

      it('resposta que não é JSON: FAILURE', async () => {
        const { slug } = await createSource();
        behavior = (_r, respond) => respond.raw(200, '<html>manutenção</html>');

        await expect(call(slug)).resolves.toMatchObject({
          outcome: SourceOutcome.FAILURE,
          message: 'resposta não é um JSON válido',
        });
      });

      it('resposta maior que o limite: FAILURE, sem carregá-la', async () => {
        const { slug } = await createSource();
        behavior = (_r, respond) =>
          respond.raw(
            200,
            JSON.stringify({ d: 'x'.repeat(MAX_RESPONSE_BYTES) }),
          );

        await expect(call(slug)).resolves.toMatchObject({
          outcome: SourceOutcome.FAILURE,
          message: 'resposta maior que o limite aceito',
        });
      });

      it('fonte fora do ar (conexão recusada): FAILURE com a causa', async () => {
        // Uma porta que acabou de ser liberada: ninguém escuta nela.
        const closed = createServer();
        await new Promise<void>((resolve) =>
          closed.listen(0, '127.0.0.1', resolve),
        );
        const { port } = closed.address() as AddressInfo;
        await new Promise<void>((resolve) => closed.close(() => resolve()));
        const { slug, id } = await createSource({
          base_url: `http://127.0.0.1:${port}/api`,
        });

        const response = await call(slug);

        expect(response).toMatchObject({
          outcome: SourceOutcome.FAILURE,
          message: expect.stringContaining('ECONNREFUSED'),
        });
        expect((await logsOf(id))[0]).toMatchObject({
          outcome: RequestOutcome.FAILURE,
        });
      });

      it('redirecionamento não é seguido: FAILURE, e o destino não é contatado', async () => {
        const { slug } = await createSource();
        behavior = (_r, respond) =>
          respond.redirect(`${baseUrl}/alvo-do-redirecionamento`);

        await expect(call(slug)).resolves.toMatchObject({
          outcome: SourceOutcome.FAILURE,
          status: 302,
        });
        expect(pendingRedirectHits).toEqual([]);
      });
    });

    describe('tempo máximo', () => {
      it('esgotado o tempo da fonte, responde TIMEOUT sem esperar a resposta', async () => {
        const { slug, id } = await createSource({ request_timeout_ms: 200 });
        behavior = (_r, respond) => respond.hang(5_000);
        const startedAt = Date.now();

        const response = await call(slug);

        expect(response).toMatchObject({ outcome: SourceOutcome.TIMEOUT });
        expect(Date.now() - startedAt).toBeLessThan(2_000);
        const [log] = await logsOf(id);
        expect(log.outcome).toBe(RequestOutcome.TIMEOUT);
        expect(log.duration_ms).toBeGreaterThanOrEqual(150);
      });

      it('o tempo é o do catálogo: uma fonte lenta com tempo maior responde', async () => {
        const { slug } = await createSource({ request_timeout_ms: 3_000 });
        behavior = (_r, respond) => respond.hang(400);

        await expect(call(slug)).resolves.toMatchObject({
          outcome: SourceOutcome.SUCCESS,
        });
      });
    });

    describe('limite de requisições por minuto', () => {
      it('chama a fonte até o teto e recusa a partir dele, sem chamá-la', async () => {
        const { slug, id } = await createSource({ rate_limit_per_minute: 3 });

        const outcomes: string[] = [];
        for (let attempt = 0; attempt < 5; attempt += 1) {
          outcomes.push((await call(slug)).outcome);
        }

        expect(outcomes).toEqual([
          SourceOutcome.SUCCESS,
          SourceOutcome.SUCCESS,
          SourceOutcome.SUCCESS,
          SourceOutcome.RATE_LIMITED,
          SourceOutcome.RATE_LIMITED,
        ]);
        expect(received).toHaveLength(3);
        const logs = await logsOf(id);
        expect(logs.map(({ outcome }) => outcome)).toEqual([
          'SUCCESS',
          'SUCCESS',
          'SUCCESS',
          'RATE_LIMITED',
          'RATE_LIMITED',
        ]);
        // Recusada antes da chamada: não há status HTTP.
        expect(logs[3].http_status ?? null).toBeNull();
        expect(logs[3].error_message).toContain('3 requisições por minuto');
      });

      it('chamadas simultâneas também respeitam o teto', async () => {
        const { slug } = await createSource({ rate_limit_per_minute: 4 });

        const responses = await Promise.all(
          Array.from({ length: 12 }, () => call(slug)),
        );

        expect(
          responses.filter(({ outcome }) => outcome === SourceOutcome.SUCCESS),
        ).toHaveLength(4);
        expect(received).toHaveLength(4);
      });

      it('cada fonte tem a sua cota', async () => {
        const first = await createSource({ rate_limit_per_minute: 1 });
        const second = await createSource({ rate_limit_per_minute: 1 });
        await call(first.slug);

        await expect(call(first.slug)).resolves.toMatchObject({
          outcome: SourceOutcome.RATE_LIMITED,
        });
        await expect(call(second.slug)).resolves.toMatchObject({
          outcome: SourceOutcome.SUCCESS,
        });
      });

      it('mudar o limite no catálogo vale na chamada seguinte, sem novo deploy', async () => {
        const { slug, id } = await createSource({ rate_limit_per_minute: 1 });
        await call(slug);
        await expect(call(slug)).resolves.toMatchObject({
          outcome: SourceOutcome.RATE_LIMITED,
        });

        await prisma.dataSource.update({
          where: { id_data_source: id },
          data: { rate_limit_per_minute: 100 },
        });

        await expect(call(slug)).resolves.toMatchObject({
          outcome: SourceOutcome.SUCCESS,
        });
      });

      it('sem limite declarado, não há teto', async () => {
        const { slug } = await createSource();

        const responses = await Promise.all(
          Array.from({ length: 10 }, () => call(slug)),
        );

        expect(
          responses.every(({ outcome }) => outcome === SourceOutcome.SUCCESS),
        ).toBe(true);
      });
    });

    describe('catálogo', () => {
      it('fonte desabilitada: DISABLED, sem chamada nem log', async () => {
        const { slug, id } = await createSource({ is_enabled: false });

        await expect(call(slug)).resolves.toEqual({
          outcome: SourceOutcome.DISABLED,
        });

        expect(received).toHaveLength(0);
        expect(await logsOf(id)).toHaveLength(0);
      });

      it('habilitar a fonte no catálogo vale na chamada seguinte', async () => {
        const { slug, id } = await createSource({ is_enabled: false });
        await call(slug);

        await prisma.dataSource.update({
          where: { id_data_source: id },
          data: { is_enabled: true },
        });

        await expect(call(slug)).resolves.toMatchObject({
          outcome: SourceOutcome.SUCCESS,
        });
      });

      it('fonte inexistente é erro de programação: lança', async () => {
        await expect(call('NAO_EXISTE')).rejects.toBeInstanceOf(
          UnknownDataSourceError,
        );
      });

      it('as fontes do seed têm o que as chamadas precisam', async () => {
        await prisma.seed(
          (await import('@app/database/catalog.seeders.js')).CATALOG_SEEDERS,
        );

        const config = await prisma.dataSource.findUniqueOrThrow({
          where: { slug: 'CGU_CEIS' },
        });

        expect(config.rate_limit_per_minute).toBe(90);
        expect(config.request_timeout_ms).toBe(5_000);
        expect(config.base_url).toMatch(/^https:\/\//);
      });
    });
  },
);
