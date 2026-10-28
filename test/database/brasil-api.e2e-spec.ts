import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { RequestOutcome, RequestTrigger } from '@prisma/client';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { BrasilApiDataSource } from '@modules/brasil-api/infra/providers/brasil-api.data-source.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import { receitaOpenDataCnpjFactory } from '../factories/data-sources/receita-open-data-cnpj.factory.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { resetSourceRateLimits } from '../support/source-rate-limit.js';
import { testRedisUrl } from '../support/infrastructure.js';

const REDIS_URL = testRedisUrl();
const CNPJ = '11222333000181';
const context = { trigger: RequestTrigger.ON_DEMAND_JOB };

type Handler = (url: string) => { status: number; body: string };

/**
 * Adapter da BrasilAPI contra o catálogo do seed, banco e Redis reais (RF03).
 * A BrasilAPI é um servidor local que fala o formato dela; o catálogo é o do
 * seed, só com a URL base trocada.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Adapter BrasilAPI (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let dataSource: BrasilApiDataSource;
    let server: Server;
    let baseUrl: string;
    let handler: Handler;
    const requested: string[] = [];
    const timers: NodeJS.Timeout[] = [];

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      dataSource = app.get(BrasilApiDataSource, { strict: false });
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
        body: JSON.stringify(receitaOpenDataCnpjFactory.build()),
      });
      await prisma.reset(['data_sources', 'data_source_request_logs']);
      await prisma.seed(CATALOG_SEEDERS);
      await prisma.dataSource.update({
        where: { slug: 'BRASIL_API' },
        data: { base_url: `${baseUrl}/api/cnpj/v1` },
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
        where: { data_source: { slug: 'BRASIL_API' } },
        orderBy: { requested_at: 'asc' },
      });

    it('consulta o CNPJ no caminho da BrasilAPI e devolve o cadastro normalizado', async () => {
      handler = () => ({
        status: 200,
        body: JSON.stringify(
          receitaOpenDataCnpjFactory.build({
            razao_social: 'ACME SERVICOS LTDA',
            nome_fantasia: 'ACME',
          }),
        ),
      });

      const result = await dataSource.fetch(CNPJ, context);

      expect(requested).toEqual([`/api/cnpj/v1/${CNPJ}`]);
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
            cityIbgeCode: '3550308',
            uf: 'SP',
            zipcode: '01310200',
          },
          mainCnae: {
            code: '6201501',
            description:
              'Desenvolvimento de programas de computador sob encomenda',
          },
          secondaryCnaes: [
            expect.objectContaining({ code: '6202300' }),
            expect.objectContaining({ code: '6311900' }),
          ],
        },
      });
    });

    it('sócios e contatos da resposta não saem do adapter (INL02)', async () => {
      const result = await dataSource.fetch(CNPJ, context);
      const text = JSON.stringify(result);

      expect(text).not.toContain('MARIA APARECIDA');
      expect(text).not.toContain('JOAO CARLOS');
      expect(text).not.toContain('1133334444');
      expect(text).not.toContain('qsa');
    });

    it('registra a chamada no log, no nome da BrasilAPI, com o CNPJ e a origem', async () => {
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
      handler = () => ({
        status: 404,
        body: JSON.stringify({ message: 'CNPJ não encontrado' }),
      });

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

    it('resposta que não é JSON (página de manutenção): indisponível', async () => {
      handler = () => ({ status: 200, body: '<html>manutenção</html>' });

      await expect(dataSource.fetch(CNPJ, context)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
        reason: 'FAILURE',
      });
    });

    it('JSON de outro formato: indisponível, nunca dado', async () => {
      handler = () => ({
        status: 200,
        body: JSON.stringify({ message: 'Internal Server Error' }),
      });

      await expect(dataSource.fetch(CNPJ, context)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
      });
    });

    it('resposta do CNPJ de outra empresa: indisponível', async () => {
      handler = () => ({
        status: 200,
        body: JSON.stringify(
          receitaOpenDataCnpjFactory.build({ cnpj: '00000000000191' }),
        ),
      });

      await expect(dataSource.fetch(CNPJ, context)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
        reason: 'FAILURE',
      });
    });

    it('tempo máximo do catálogo esgotado: indisponível por TIMEOUT', async () => {
      await prisma.dataSource.update({
        where: { slug: 'BRASIL_API' },
        data: { request_timeout_ms: 200 },
      });
      handler = () => ({ status: -1, body: '{}' });

      await expect(dataSource.fetch(CNPJ, context)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
        reason: 'TIMEOUT',
      });
      expect((await logs())[0].outcome).toBe(RequestOutcome.TIMEOUT);
    });

    it('respeita o limite por minuto do catálogo, sem chamar a BrasilAPI', async () => {
      await prisma.dataSource.update({
        where: { slug: 'BRASIL_API' },
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
        where: { slug: 'BRASIL_API' },
        data: { is_enabled: false },
      });

      await expect(dataSource.fetch(CNPJ, context)).resolves.toEqual({
        status: 'UNAVAILABLE',
        reason: 'DISABLED',
      });
      expect(requested).toHaveLength(0);
    });

    it('é o primeiro da cadeia de fallback cadastral no catálogo', async () => {
      const source = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: dataSource.slug },
      });

      expect(source).toMatchObject({
        role: 'CADASTRAL',
        fallback_priority: 1,
      });
    });
  },
);
