import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { RequestOutcome, RequestTrigger } from '@prisma/client';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { ReceitaDataSource } from '@modules/receita/infra/providers/receita.data-source.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import { openCnpjFactory } from '../factories/data-sources/opencnpj-cnpj.factory.js';
import { receitaOpenDataCnpjFactory } from '../factories/data-sources/receita-open-data-cnpj.factory.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { resetSourceRateLimits } from '../support/source-rate-limit.js';

const REDIS_URL = inject('testRedisUrl');
const CNPJ = '11222333000181';
const context = { trigger: RequestTrigger.ON_DEMAND_JOB };

type Slug = 'BRASIL_API' | 'OPEN_CNPJ' | 'MINHA_RECEITA';
type Behavior = 'ok' | 'not-found' | 'error' | 'hang' | 'wrong-cnpj';

const PREFIX: Record<Slug, string> = {
  BRASIL_API: '/brasil',
  OPEN_CNPJ: '/open',
  MINHA_RECEITA: '/minha',
};

/**
 * Cadeia de fallback cadastral ponta a ponta (RF03): os três adapters reais, o
 * catálogo do seed, banco e Redis reais. Cada provedor é um caminho de um
 * servidor local com comportamento configurável, no formato do provedor.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Cadeia de fallback cadastral (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let chain: ReceitaDataSource;
    let server: Server;
    let baseUrl: string;
    const behavior: Record<Slug, Behavior> = {
      BRASIL_API: 'ok',
      OPEN_CNPJ: 'ok',
      MINHA_RECEITA: 'ok',
    };
    const hits: string[] = [];
    const timers: NodeJS.Timeout[] = [];

    /** O corpo de cada provedor, com a razão social que o identifica. */
    function bodyOf(slug: Slug, wrongCnpj: boolean): string {
      const cnpj = wrongCnpj ? '00000000000191' : CNPJ;

      return JSON.stringify(
        slug === 'OPEN_CNPJ'
          ? openCnpjFactory.build({ cnpj, razao_social: `EMPRESA VIA ${slug}` })
          : receitaOpenDataCnpjFactory.build({
              cnpj,
              razao_social: `EMPRESA VIA ${slug}`,
            }),
      );
    }

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      chain = app.get(ReceitaDataSource, { strict: false });
      server = createServer((request, response) => {
        const url = request.url ?? '';
        const slug = (Object.keys(PREFIX) as Slug[]).find((candidate) =>
          url.startsWith(`${PREFIX[candidate]}/`),
        );

        if (!slug) {
          response.writeHead(404).end('{}');

          return;
        }

        hits.push(slug);
        const mode = behavior[slug];
        const json = { 'content-type': 'application/json' };

        switch (mode) {
          case 'ok':
          case 'wrong-cnpj':
            response
              .writeHead(200, json)
              .end(bodyOf(slug, mode === 'wrong-cnpj'));
            break;
          case 'not-found':
            response.writeHead(404, json).end('{"message":"nao encontrado"}');
            break;
          case 'error':
            response.writeHead(500, json).end('{}');
            break;
          case 'hang':
            timers.push(
              setTimeout(() => response.writeHead(200).end('{}'), 5_000),
            );
            break;
        }
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    beforeEach(async () => {
      hits.length = 0;
      behavior.BRASIL_API = 'ok';
      behavior.OPEN_CNPJ = 'ok';
      behavior.MINHA_RECEITA = 'ok';
      await prisma.reset(['data_sources', 'data_source_request_logs']);
      await prisma.seed(CATALOG_SEEDERS);
      for (const slug of Object.keys(PREFIX) as Slug[]) {
        await prisma.dataSource.update({
          where: { slug },
          data: {
            base_url: `${baseUrl}${PREFIX[slug]}`,
            request_timeout_ms: 300,
          },
        });
      }
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

    const loggedSlugs = async () =>
      (
        await prisma.dataSourceRequestLog.findMany({
          orderBy: { requested_at: 'asc' },
          include: { data_source: { select: { slug: true } } },
        })
      ).map(({ data_source }) => data_source.slug);

    describe('o primeiro provedor responde', () => {
      it('devolve o cadastro e o provedor, sem consultar os demais', async () => {
        const result = await chain.fetch(CNPJ, context);

        expect(result).toMatchObject({
          status: 'FOUND',
          data: {
            sourceSlug: 'BRASIL_API',
            record: { cnpj: CNPJ, legalName: 'EMPRESA VIA BRASIL_API' },
          },
        });
        expect(hits).toEqual(['BRASIL_API']);
        expect(await loggedSlugs()).toEqual(['BRASIL_API']);
      });
    });

    describe('fallback', () => {
      it('BrasilAPI com erro: o OpenCNPJ responde', async () => {
        behavior.BRASIL_API = 'error';

        const result = await chain.fetch(CNPJ, context);

        expect(result).toMatchObject({
          status: 'FOUND',
          data: {
            sourceSlug: 'OPEN_CNPJ',
            record: { legalName: 'EMPRESA VIA OPEN_CNPJ' },
          },
        });
        expect(hits).toEqual(['BRASIL_API', 'OPEN_CNPJ']);
      });

      it('os dois primeiros fora do ar: o Minha Receita responde', async () => {
        behavior.BRASIL_API = 'error';
        behavior.OPEN_CNPJ = 'hang';

        const result = await chain.fetch(CNPJ, context);

        expect(result).toMatchObject({
          status: 'FOUND',
          data: { sourceSlug: 'MINHA_RECEITA' },
        });
        expect(hits).toEqual(['BRASIL_API', 'OPEN_CNPJ', 'MINHA_RECEITA']);
      });

      it('cada tentativa fica registrada no log, com o resultado de cada provedor', async () => {
        behavior.BRASIL_API = 'error';
        behavior.OPEN_CNPJ = 'hang';

        await chain.fetch(CNPJ, context);

        const logs = await prisma.dataSourceRequestLog.findMany({
          orderBy: { requested_at: 'asc' },
          include: { data_source: { select: { slug: true } } },
        });
        expect(
          logs.map(({ data_source, outcome }) => [data_source.slug, outcome]),
        ).toEqual([
          ['BRASIL_API', RequestOutcome.FAILURE],
          ['OPEN_CNPJ', RequestOutcome.TIMEOUT],
          ['MINHA_RECEITA', RequestOutcome.SUCCESS],
        ]);
      });

      it('resposta do CNPJ de outra empresa não serve: segue para o próximo', async () => {
        behavior.BRASIL_API = 'wrong-cnpj';

        const result = await chain.fetch(CNPJ, context);

        expect(result).toMatchObject({
          status: 'FOUND',
          data: { sourceSlug: 'OPEN_CNPJ', record: { cnpj: CNPJ } },
        });
      });

      it('provedor que estourou o limite por minuto é pulado, sem ser chamado', async () => {
        await prisma.dataSource.update({
          where: { slug: 'BRASIL_API' },
          data: { rate_limit_per_minute: 1 },
        });
        await chain.fetch(CNPJ, context);
        hits.length = 0;

        const result = await chain.fetch(CNPJ, context);

        expect(result).toMatchObject({
          status: 'FOUND',
          data: { sourceSlug: 'OPEN_CNPJ' },
        });
        expect(hits).toEqual(['OPEN_CNPJ']);
      });

      it('um provedor sem o CNPJ não encerra a cadeia: o seguinte pode conhecê-lo', async () => {
        behavior.BRASIL_API = 'not-found';

        await expect(chain.fetch(CNPJ, context)).resolves.toMatchObject({
          status: 'FOUND',
          data: { sourceSlug: 'OPEN_CNPJ' },
        });
      });
    });

    describe('sem cadastro', () => {
      it('todos os provedores sem o CNPJ: não encontrado', async () => {
        behavior.BRASIL_API = 'not-found';
        behavior.OPEN_CNPJ = 'not-found';
        behavior.MINHA_RECEITA = 'not-found';

        await expect(chain.fetch(CNPJ, context)).resolves.toEqual({
          status: 'NOT_FOUND',
        });
        expect(hits).toEqual(['BRASIL_API', 'OPEN_CNPJ', 'MINHA_RECEITA']);
      });

      it('um provedor sem o CNPJ e outro fora do ar: indisponível, não "não existe"', async () => {
        behavior.BRASIL_API = 'not-found';
        behavior.OPEN_CNPJ = 'error';
        behavior.MINHA_RECEITA = 'not-found';

        await expect(chain.fetch(CNPJ, context)).resolves.toMatchObject({
          status: 'UNAVAILABLE',
          reason: 'FAILURE',
        });
      });

      it('todos fora do ar: indisponível, com o histórico de cada provedor', async () => {
        behavior.BRASIL_API = 'error';
        behavior.OPEN_CNPJ = 'hang';
        behavior.MINHA_RECEITA = 'error';

        await expect(chain.fetch(CNPJ, context)).resolves.toEqual({
          status: 'UNAVAILABLE',
          reason: 'FAILURE',
          message:
            'BRASIL_API: FAILURE; OPEN_CNPJ: TIMEOUT; MINHA_RECEITA: FAILURE',
        });
      });
    });

    describe('a cadeia é do catálogo', () => {
      it('trocar as prioridades muda a ordem das consultas, sem novo deploy', async () => {
        await prisma.dataSource.update({
          where: { slug: 'MINHA_RECEITA' },
          data: { fallback_priority: 1 },
        });
        await prisma.dataSource.update({
          where: { slug: 'BRASIL_API' },
          data: { fallback_priority: 3 },
        });

        const result = await chain.fetch(CNPJ, context);

        expect(result).toMatchObject({
          status: 'FOUND',
          data: { sourceSlug: 'MINHA_RECEITA' },
        });
        expect(hits).toEqual(['MINHA_RECEITA']);
      });

      it('provedor desabilitado no catálogo sai da cadeia: nem é chamado', async () => {
        await prisma.dataSource.update({
          where: { slug: 'BRASIL_API' },
          data: { is_enabled: false },
        });

        const result = await chain.fetch(CNPJ, context);

        expect(result).toMatchObject({
          status: 'FOUND',
          data: { sourceSlug: 'OPEN_CNPJ' },
        });
        expect(hits).toEqual(['OPEN_CNPJ']);
        expect(await loggedSlugs()).toEqual(['OPEN_CNPJ']);
      });

      it('provedor desabilitado não impede concluir "não encontrado"', async () => {
        await prisma.dataSource.update({
          where: { slug: 'BRASIL_API' },
          data: { is_enabled: false },
        });
        behavior.OPEN_CNPJ = 'not-found';
        behavior.MINHA_RECEITA = 'not-found';

        await expect(chain.fetch(CNPJ, context)).resolves.toEqual({
          status: 'NOT_FOUND',
        });
      });

      it('todos desabilitados: indisponível por DISABLED, sem chamada', async () => {
        await prisma.dataSource.updateMany({
          where: { role: 'CADASTRAL' },
          data: { is_enabled: false },
        });

        await expect(chain.fetch(CNPJ, context)).resolves.toEqual({
          status: 'UNAVAILABLE',
          reason: 'DISABLED',
          message: 'nenhum provedor cadastral habilitado',
        });
        expect(hits).toEqual([]);
      });

      it('o IBGE (taxonomia de CNAE) não faz parte da cadeia cadastral', async () => {
        const source = await prisma.dataSource.findUniqueOrThrow({
          where: { slug: 'IBGE_CNAE' },
        });

        expect(source.role).not.toBe('CADASTRAL');
        await chain.fetch(CNPJ, context);
        expect(hits).not.toContain('IBGE_CNAE');
      });
    });
  },
);
