import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { RequestOutcome, RequestTrigger } from '@prisma/client';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { IbgeCnaeDataSource } from '@modules/ibge-cnae/infra/providers/ibge-cnae.data-source.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import { ibgeCnaeSubclassFactory } from '../factories/data-sources/ibge-cnae.factory.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { resetSourceRateLimits } from '../support/source-rate-limit.js';

const REDIS_URL = inject('testRedisUrl');
const CODE = '6201501';
const context = { trigger: RequestTrigger.ON_DEMAND_JOB };

type Handler = (url: string) => { status: number; body: string };

/**
 * Adapter do IBGE (CNAE) contra o catálogo do seed, banco e Redis reais (RF06).
 * A API de Classificações é um servidor local; o catálogo é o do seed, só com
 * a URL base trocada.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Adapter IBGE CNAE (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let dataSource: IbgeCnaeDataSource;
    let server: Server;
    let baseUrl: string;
    let handler: Handler;
    const requested: string[] = [];
    const timers: NodeJS.Timeout[] = [];

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      dataSource = app.get(IbgeCnaeDataSource, { strict: false });
      server = createServer((request, response) => {
        requested.push(request.url ?? '');
        const { status, body } = handler(request.url ?? '');

        if (status === -1) {
          timers.push(
            setTimeout(() => response.writeHead(200).end(body), 5_000),
          );

          return;
        }

        response
          .writeHead(status, { 'content-type': 'application/json' })
          .end(body);
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    beforeEach(async () => {
      requested.length = 0;
      handler = () => ({
        status: 200,
        body: JSON.stringify(ibgeCnaeSubclassFactory.build()),
      });
      await prisma.reset(['data_sources', 'data_source_request_logs']);
      await prisma.seed(CATALOG_SEEDERS);
      await prisma.dataSource.update({
        where: { slug: 'IBGE_CNAE' },
        data: { base_url: `${baseUrl}/api/v2/cnae` },
      });
      await resetSourceRateLimits(REDIS_URL);
    });

    afterEach(() => {
      timers.splice(0).forEach(clearTimeout);
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.reset(['data_sources', 'data_source_request_logs']);
      await resetSourceRateLimits(REDIS_URL);
      await app.close();
    });

    const logs = () =>
      prisma.dataSourceRequestLog.findMany({
        where: { data_source: { slug: 'IBGE_CNAE' } },
        orderBy: { requested_at: 'asc' },
      });

    it('consulta a subclasse no caminho do IBGE e devolve a descrição oficial', async () => {
      const result = await dataSource.fetch(CODE, context);

      expect(requested).toEqual([`/api/v2/cnae/subclasses/${CODE}`]);
      expect(result).toEqual({
        status: 'FOUND',
        data: {
          code: CODE,
          description:
            'DESENVOLVIMENTO DE PROGRAMAS DE COMPUTADOR SOB ENCOMENDA',
        },
      });
    });

    it('entende a resposta em forma de lista', async () => {
      handler = () => ({
        status: 200,
        body: JSON.stringify([ibgeCnaeSubclassFactory.build()]),
      });

      await expect(dataSource.fetch(CODE, context)).resolves.toMatchObject({
        status: 'FOUND',
        data: { code: CODE },
      });
    });

    it('só a descrição sai do adapter: hierarquia e notas explicativas ficam de fora', async () => {
      const text = JSON.stringify(await dataSource.fetch(CODE, context));

      expect(text).not.toContain('INFORMAÇÃO E COMUNICAÇÃO');
      expect(text).not.toContain('APLICATIVO INFORMÁTICO');
    });

    it('registra a chamada no log, sem CNPJ (a consulta é da taxonomia)', async () => {
      await dataSource.fetch(CODE, { trigger: RequestTrigger.SCHEDULED_JOB });

      const [log] = await logs();
      expect(log).toMatchObject({
        trigger: RequestTrigger.SCHEDULED_JOB,
        outcome: RequestOutcome.SUCCESS,
        http_status: 200,
      });
      expect(log.cnpj ?? null).toBeNull();
    });

    it('lista vazia: o código não existe na taxonomia', async () => {
      handler = () => ({ status: 200, body: '[]' });

      await expect(dataSource.fetch('9999999', context)).resolves.toEqual({
        status: 'NOT_FOUND',
      });
      expect((await logs())[0].outcome).toBe(RequestOutcome.SUCCESS);
    });

    it('404 do IBGE: não encontrado', async () => {
      handler = () => ({ status: 404, body: '{}' });

      await expect(dataSource.fetch(CODE, context)).resolves.toEqual({
        status: 'NOT_FOUND',
      });
      expect((await logs())[0].outcome).toBe(RequestOutcome.NOT_FOUND);
    });

    it('código que não é CNAE: não encontrado, sem chamar o IBGE', async () => {
      await expect(dataSource.fetch('abc', context)).resolves.toEqual({
        status: 'NOT_FOUND',
      });

      expect(requested).toHaveLength(0);
      expect(await logs()).toHaveLength(0);
    });

    it('resposta com a subclasse de outro código: não encontrado, nunca a descrição alheia', async () => {
      handler = () => ({
        status: 200,
        body: JSON.stringify(ibgeCnaeSubclassFactory.build({ id: '6202300' })),
      });

      await expect(dataSource.fetch(CODE, context)).resolves.toEqual({
        status: 'NOT_FOUND',
      });
    });

    it('500 e resposta que não é JSON: fonte indisponível', async () => {
      handler = () => ({ status: 500, body: '{}' });
      await expect(dataSource.fetch(CODE, context)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
        reason: 'FAILURE',
      });

      handler = () => ({ status: 200, body: '<html>manutenção</html>' });
      await expect(dataSource.fetch(CODE, context)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
        reason: 'FAILURE',
      });
    });

    it('tempo máximo do catálogo esgotado: indisponível por TIMEOUT', async () => {
      await prisma.dataSource.update({
        where: { slug: 'IBGE_CNAE' },
        data: { request_timeout_ms: 200 },
      });
      handler = () => ({ status: -1, body: '{}' });

      await expect(dataSource.fetch(CODE, context)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
        reason: 'TIMEOUT',
      });
      expect((await logs())[0].outcome).toBe(RequestOutcome.TIMEOUT);
    });

    it('respeita o limite por minuto do catálogo, sem chamar o IBGE', async () => {
      await prisma.dataSource.update({
        where: { slug: 'IBGE_CNAE' },
        data: { rate_limit_per_minute: 2 },
      });

      const results = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        results.push(await dataSource.fetch(CODE, context));
      }

      expect(results.map(({ status }) => status)).toEqual([
        'FOUND',
        'FOUND',
        'UNAVAILABLE',
        'UNAVAILABLE',
      ]);
      expect(results[2]).toMatchObject({ reason: 'RATE_LIMITED' });
      expect(requested).toHaveLength(2);
    });

    it('fonte desabilitada no catálogo: indisponível, sem chamada', async () => {
      await prisma.dataSource.update({
        where: { slug: 'IBGE_CNAE' },
        data: { is_enabled: false },
      });

      await expect(dataSource.fetch(CODE, context)).resolves.toEqual({
        status: 'UNAVAILABLE',
        reason: 'DISABLED',
      });
      expect(requested).toHaveLength(0);
    });

    it('é a fonte da taxonomia de CNAE, fora da cadeia cadastral, com janela de cache longa', async () => {
      const source = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: dataSource.slug },
      });

      expect(source).toMatchObject({
        role: 'CNAE_TAXONOMY',
        cache_ttl_seconds: 30 * 86_400,
      });
      expect(source.fallback_priority ?? null).toBeNull();
    });
  },
);
