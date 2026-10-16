import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { RequestOutcome, RequestTrigger } from '@prisma/client';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { OpenCnpjDataSource } from '@modules/opencnpj/infra/providers/opencnpj.data-source.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import { openCnpjFactory } from '../factories/data-sources/opencnpj-cnpj.factory.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { resetSourceRateLimits } from '../support/source-rate-limit.js';

const REDIS_URL = inject('testRedisUrl');
const CNPJ = '11222333000181';
const context = { trigger: RequestTrigger.ON_DEMAND_JOB };

type Handler = (url: string) => { status: number; body: string };

/**
 * Adapter do OpenCNPJ contra o catálogo do seed, banco e Redis reais (RF03).
 * O OpenCNPJ é um servidor local que fala o formato dele; o catálogo é o do
 * seed, só com a URL base trocada.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Adapter OpenCNPJ (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let dataSource: OpenCnpjDataSource;
    let server: Server;
    let baseUrl: string;
    let handler: Handler;
    const requested: string[] = [];
    const timers: NodeJS.Timeout[] = [];

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      dataSource = app.get(OpenCnpjDataSource, { strict: false });
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
        body: JSON.stringify(openCnpjFactory.build()),
      });
      await prisma.reset(['data_sources', 'data_source_request_logs']);
      await prisma.seed(CATALOG_SEEDERS);
      await prisma.dataSource.update({
        where: { slug: 'OPEN_CNPJ' },
        data: { base_url: baseUrl },
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
        where: { data_source: { slug: 'OPEN_CNPJ' } },
        orderBy: { requested_at: 'asc' },
      });

    it('consulta o CNPJ no caminho do OpenCNPJ e devolve o cadastro normalizado', async () => {
      handler = () => ({
        status: 200,
        body: JSON.stringify(
          openCnpjFactory.build({
            razao_social: 'ACME SERVICOS LTDA',
            nome_fantasia: 'ACME',
          }),
        ),
      });

      const result = await dataSource.fetch(CNPJ, context);

      expect(requested).toEqual([`/${CNPJ}`]);
      expect(result).toEqual({
        status: 'FOUND',
        data: {
          cnpj: CNPJ,
          legalName: 'ACME SERVICOS LTDA',
          tradeName: 'ACME',
          registrationStatus: 'ATIVA',
          companySize: 'DEMAIS',
          address: {
            street: 'AVENIDA PAULISTA',
            number: '1578',
            complement: 'ANDAR 12',
            neighborhood: 'BELA VISTA',
            city: 'SAO PAULO',
            cityIbgeCode: null,
            uf: 'SP',
            zipcode: '01310200',
          },
          mainCnae: {
            code: '6201501',
            description:
              'Desenvolvimento de programas de computador sob encomenda',
          },
          secondaryCnaes: [
            expect.objectContaining({
              code: '6202300',
              description: expect.stringContaining('customizáveis'),
            }),
            expect.objectContaining({ code: '6311900' }),
          ],
        },
      });
    });

    it('sócios, e-mail e telefones da resposta não saem do adapter (INL02)', async () => {
      const result = await dataSource.fetch(CNPJ, context);
      const text = JSON.stringify(result);

      expect(text).not.toContain('MARIA APARECIDA');
      expect(text).not.toContain('JOAO CARLOS');
      expect(text).not.toContain('33334444');
      expect(text).not.toContain('QSA');
    });

    it('registra a chamada no log, no nome do OpenCNPJ, com o CNPJ e a origem', async () => {
      await dataSource.fetch(CNPJ, context);

      const [log] = await logs();
      expect(log).toMatchObject({
        cnpj: CNPJ,
        trigger: RequestTrigger.ON_DEMAND_JOB,
        outcome: RequestOutcome.SUCCESS,
        http_status: 200,
      });
    });

    it('404: a Receita não conhece o CNPJ', async () => {
      handler = () => ({ status: 404, body: '{"error":"not found"}' });

      await expect(dataSource.fetch(CNPJ, context)).resolves.toEqual({
        status: 'NOT_FOUND',
      });
      expect((await logs())[0].outcome).toBe(RequestOutcome.NOT_FOUND);
    });

    it('500: fonte indisponível, para a cadeia tentar a próxima', async () => {
      handler = () => ({ status: 500, body: '{}' });

      await expect(dataSource.fetch(CNPJ, context)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
        reason: 'FAILURE',
      });
    });

    it('registro anonimizado (LGPD): indisponível, nunca dado mascarado', async () => {
      handler = () => ({
        status: 200,
        body: JSON.stringify(
          openCnpjFactory.build({
            lgpd_anonimizado: true,
            razao_social: '***',
          }),
        ),
      });

      await expect(dataSource.fetch(CNPJ, context)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
        reason: 'FAILURE',
      });
    });

    it('resposta do CNPJ de outra empresa: indisponível', async () => {
      handler = () => ({
        status: 200,
        body: JSON.stringify(openCnpjFactory.build({ cnpj: '00000000000191' })),
      });

      await expect(dataSource.fetch(CNPJ, context)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
      });
    });

    it('resposta que não é JSON (página de manutenção): indisponível', async () => {
      handler = () => ({ status: 200, body: '<html>manutenção</html>' });

      await expect(dataSource.fetch(CNPJ, context)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
      });
    });

    it('tempo máximo do catálogo esgotado: indisponível por TIMEOUT', async () => {
      await prisma.dataSource.update({
        where: { slug: 'OPEN_CNPJ' },
        data: { request_timeout_ms: 200 },
      });
      handler = () => ({ status: -1, body: '{}' });

      await expect(dataSource.fetch(CNPJ, context)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
        reason: 'TIMEOUT',
      });
      expect((await logs())[0].outcome).toBe(RequestOutcome.TIMEOUT);
    });

    it('respeita o limite por minuto do catálogo, sem chamar o OpenCNPJ', async () => {
      await prisma.dataSource.update({
        where: { slug: 'OPEN_CNPJ' },
        data: { rate_limit_per_minute: 2 },
      });

      const results = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        results.push(await dataSource.fetch(CNPJ, context));
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
        where: { slug: 'OPEN_CNPJ' },
        data: { is_enabled: false },
      });

      await expect(dataSource.fetch(CNPJ, context)).resolves.toEqual({
        status: 'UNAVAILABLE',
        reason: 'DISABLED',
      });
      expect(requested).toHaveLength(0);
    });

    it('é o primeiro fallback da cadeia cadastral no catálogo', async () => {
      const source = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: dataSource.slug },
      });

      expect(source).toMatchObject({
        role: 'CADASTRAL',
        fallback_priority: 2,
      });
    });
  },
);
