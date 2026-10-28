import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { RequestOutcome, RequestTrigger } from '@prisma/client';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { RefreshCompanyProfileUseCase } from '@modules/companies/infra/usecases/refresh-company-profile.usecase.js';
import { CompanyProfileResponseSchema } from '@modules/companies/domain/dtos/requests/company-profile.dto.js';
import { ErrorResponseSchema } from '@shared/domain/dtos/errors/error-response.dto.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { Queue } from 'bullmq';
import request from 'supertest';
import { inject } from 'vitest';
import { openCnpjFactory } from '../factories/data-sources/opencnpj-cnpj.factory.js';
import { receitaOpenDataCnpjFactory } from '../factories/data-sources/receita-open-data-cnpj.factory.js';
import { ibgeCnaeSubclassFactory } from '../factories/data-sources/ibge-cnae.factory.js';
import { resetCache } from '../support/cache.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { resetSourceRateLimits } from '../support/source-rate-limit.js';
import { withoutEnvironmentalCollection } from '../support/without-environmental-collection.js';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';
import { testRedisUrl } from '../support/infrastructure.js';

const REDIS_URL = testRedisUrl();
const CNPJ = '11222333000181';
const OTHER_CNPJ = '00000000000191';
const SEVEN_DAYS_MS = 7 * 86_400_000;

type Source = 'BRASIL_API' | 'OPEN_CNPJ' | 'MINHA_RECEITA' | 'IBGE_CNAE';
type Behavior = 'ok' | 'not-found' | 'error' | 'hang';

const PREFIX: Record<Source, string> = {
  BRASIL_API: '/brasil',
  OPEN_CNPJ: '/open',
  MINHA_RECEITA: '/minha',
  IBGE_CNAE: '/ibge',
};

/**
 * Atualização do cadastro ponta a ponta (RF03, RF05, RF06): a requisição HTTP,
 * a fila BullMQ, o **consumidor real** (`CompanyProfileProcessor`), a cadeia de
 * provedores, a descrição do IBGE e a gravação no MongoDB. Os provedores são
 * caminhos de um servidor local, cada um com o formato e o comportamento
 * configuráveis.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Atualização do cadastro pelo consumidor da fila (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let server: Server;
    let baseUrl: string;
    let accessToken: string;
    const behavior: Record<Source, Behavior> = {
      BRASIL_API: 'ok',
      OPEN_CNPJ: 'ok',
      MINHA_RECEITA: 'ok',
      IBGE_CNAE: 'ok',
    };
    let legalName = 'ACME SERVICOS LTDA';
    const hits: string[] = [];
    const timers: NodeJS.Timeout[] = [];

    function bodyOf(source: Source, url: string): string {
      const last = url.split('?')[0].split('/').pop() ?? '';

      if (source === 'IBGE_CNAE') {
        return JSON.stringify(
          ibgeCnaeSubclassFactory.build({
            id: last,
            descricao: `DESCRIÇÃO OFICIAL ${last}`,
          }),
        );
      }

      // O nome fantasia é fixo: a factory o sorteia, e dois cadastros "iguais"
      // não podem diferir por acaso.
      const company = {
        cnpj: last,
        razao_social: legalName,
        nome_fantasia: 'ACME',
      };

      return JSON.stringify(
        source === 'OPEN_CNPJ'
          ? openCnpjFactory.build(company)
          : receitaOpenDataCnpjFactory.build(company),
      );
    }

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp(
        withoutEnvironmentalCollection,
      ));
      server = createServer((incoming, response) => {
        const url = incoming.url ?? '';
        const source = (Object.keys(PREFIX) as Source[]).find((candidate) =>
          url.startsWith(`${PREFIX[candidate]}/`),
        );

        if (!source) {
          response.writeHead(404).end('{}');

          return;
        }

        hits.push(source);
        const json = { 'content-type': 'application/json' };

        switch (behavior[source]) {
          case 'ok':
            response.writeHead(200, json).end(bodyOf(source, url));
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

      const account = await createTestAccount(app);
      const { body } = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);
      accessToken = body.access_token as string;
    });

    beforeEach(async () => {
      hits.length = 0;
      legalName = 'ACME SERVICOS LTDA';
      for (const source of Object.keys(behavior) as Source[]) {
        behavior[source] = 'ok';
      }
      await prisma.reset([
        'company_profile',
        'company_ods_scores',
        'data_sources',
        'data_source_request_logs',
      ]);
      await prisma.seed(CATALOG_SEEDERS);
      for (const source of Object.keys(PREFIX) as Source[]) {
        await prisma.dataSource.update({
          where: { slug: source },
          data: {
            base_url: `${baseUrl}${PREFIX[source]}`,
            request_timeout_ms: 300,
          },
        });
      }
      await resetSourceRateLimits(REDIS_URL);
      await resetThrottleCounters(REDIS_URL);
      await resetCache(REDIS_URL);
    });

    afterEach(async () => {
      timers.splice(0).forEach(clearTimeout);
      // Atualizar o perfil pede o recálculo dos índices (UC15): termina antes do próximo reset.
      await scoringIdle();
      await clearQueue();
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.reset([
        'users',
        'user_sessions',
        'login_attempts',
        'company_profile',
        'company_ods_scores',
        'data_sources',
        'data_source_request_logs',
      ]);
      await resetSourceRateLimits(REDIS_URL);
      await clearQueue();
      await app.close();
    });

    /** Espera a fila de scoring esvaziar: os jobs pedidos pelo perfil não podem sobrar. */
    async function scoringIdle(): Promise<void> {
      const scoring = new Queue(QueueName.ODS_SCORING, {
        connection: { url: REDIS_URL },
      });
      try {
        await vi.waitFor(
          async () => {
            const { waiting, active, delayed } = await scoring.getJobCounts(
              'waiting',
              'active',
              'delayed',
            );
            expect(waiting + active + delayed).toBe(0);
          },
          { timeout: 10_000, interval: 50 },
        );
        await scoring.obliterate({ force: true });
      } finally {
        await scoring.close();
      }
    }

    /** Esvazia a fila: o job de um CNPJ é único por janela de 60 s. */
    async function clearQueue(): Promise<void> {
      const queue = new Queue(QueueName.COMPANY_PROFILE, {
        connection: { url: REDIS_URL },
      });
      await queue.obliterate({ force: true });
      await queue.close();
    }

    const getCompany = (cnpj = CNPJ) =>
      request(app.getHttpServer())
        .get(`/companies/${cnpj}`)
        .set('Authorization', `Bearer ${accessToken}`);

    /** O documento como está no MongoDB, sem a interpretação do Prisma. */
    async function rawDocument(cnpj = CNPJ): Promise<Record<string, unknown>> {
      const documents = (await prisma.companyProfile.findRaw({
        filter: { cnpj },
      })) as unknown as Record<string, unknown>[];

      return documents[0];
    }

    /** Dá ao perfil gravado a idade que o torna vencido e esquece o cache e o job. */
    async function makeStale(cnpj = CNPJ): Promise<void> {
      await prisma.companyProfile.update({
        where: { cnpj },
        data: { refreshed_at: new Date(Date.now() - SEVEN_DAYS_MS - 60_000) },
      });
      await resetCache(REDIS_URL);
      await clearQueue();
    }

    describe('cadastro novo', () => {
      it('200: a consulta dispara a atualização e devolve o perfil gravado pelo consumidor real', async () => {
        const response = await getCompany().expect(200);

        expect(CompanyProfileResponseSchema.parse(response.body)).toMatchObject(
          {
            cnpj: CNPJ,
            legal_name: 'ACME SERVICOS LTDA',
            registration_status: 'ATIVA',
            company_size: 'DEMAIS',
            address: { city: 'SAO PAULO', uf: 'SP', city_ibge_code: '3550308' },
          },
        );
        expect(await prisma.companyProfile.count()).toBe(1);
      });

      it('a descrição dos CNAEs é a oficial do IBGE, e não a do provedor', async () => {
        const response = await getCompany().expect(200);

        expect(response.body.main_cnae).toEqual({
          code: '6201501',
          description: 'DESCRIÇÃO OFICIAL 6201501',
        });
        expect(response.body.secondary_cnaes).toEqual([
          { code: '6202300', description: 'DESCRIÇÃO OFICIAL 6202300' },
          { code: '6311900', description: 'DESCRIÇÃO OFICIAL 6311900' },
        ]);
      });

      it('grava a fonte que respondeu, o hash do conteúdo e a data da atualização', async () => {
        const before = Date.now();

        await getCompany().expect(200);

        const profile = await prisma.companyProfile.findUniqueOrThrow({
          where: { cnpj: CNPJ },
          include: { cadastral_source: { select: { slug: true } } },
        });
        expect(profile.cadastral_source.slug).toBe('BRASIL_API');
        expect(profile.content_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(profile.previous_content_hash ?? null).toBeNull();
        expect(profile.refreshed_at.getTime()).toBeGreaterThanOrEqual(
          before - 1_000,
        );
      });

      it('o documento só tem campos de pessoa jurídica: sócios, e-mail e telefones nunca chegam ao banco (INL02)', async () => {
        await getCompany().expect(200);

        const document = await rawDocument();
        const text = JSON.stringify(document);

        expect(Object.keys(document).sort()).toEqual(
          [
            '_id',
            'address',
            'cadastral_source_id',
            'cnpj',
            'company_size',
            'content_hash',
            'created_at',
            'legal_name',
            'main_cnae',
            'previous_content_hash',
            'refreshed_at',
            'registration_status',
            'registration_status_unrecognized',
            'secondary_cnaes',
            'trade_name',
            'updated_at',
          ].filter((key) => key in document),
        );
        expect(text).not.toContain('MARIA APARECIDA');
        expect(text).not.toContain('qsa');
        expect(text).not.toContain('@');
      });

      it('o CPF que a razão social do empresário individual carrega é mascarado, na resposta e no banco', async () => {
        legalName = 'JOSE DA SILVA 12345678901';

        const response = await getCompany().expect(200);

        expect(response.body.legal_name).toBe('JOSE DA SILVA ***');
        expect(JSON.stringify(await rawDocument())).not.toContain(
          '12345678901',
        );
      });
    });

    describe('recálculo dos índices (UC15, #80)', () => {
      it('atualizar o perfil pede o recálculo: UF, cidade e CNAEs desnormalizados dos índices são reescritos', async () => {
        await getCompany().expect(200);
        const profile = await prisma.companyProfile.findUniqueOrThrow({
          where: { cnpj: CNPJ },
        });
        await vi.waitFor(
          async () => {
            expect(
              await prisma.companyOdsScore.count({ where: { cnpj: CNPJ } }),
            ).toBe(2);
          },
          { timeout: 10_000, interval: 50 },
        );
        // O perfil mudou de endereço: os índices guardam a localização antiga.
        await prisma.companyOdsScore.updateMany({
          where: { cnpj: CNPJ },
          data: { uf: 'XX', city: 'Cidade antiga', cnae_codes: [] },
        });

        await app
          .get(RefreshCompanyProfileUseCase, { strict: false })
          .execute(CNPJ);

        await vi.waitFor(
          async () => {
            const scores = await prisma.companyOdsScore.findMany({
              where: { cnpj: CNPJ },
            });
            expect(scores).toHaveLength(2);
            for (const score of scores) {
              expect(score.uf).toBe(profile.address.uf);
              expect(score.city).toBe(profile.address.city);
              expect(score.cnae_codes).toContain(profile.main_cnae.code);
            }
          },
          { timeout: 10_000, interval: 50 },
        );
      });

      it('perfil não encontrado ou provedores fora do ar não pedem recálculo', async () => {
        behavior.BRASIL_API = 'error';
        behavior.OPEN_CNPJ = 'error';
        behavior.MINHA_RECEITA = 'error';

        await getCompany().expect(503);

        expect(
          await prisma.companyOdsScore.count({ where: { cnpj: CNPJ } }),
        ).toBe(0);
      });
    });

    describe('cadeia de fallback pelo consumidor', () => {
      it('BrasilAPI fora do ar: o OpenCNPJ responde, e a fonte gravada é a dele', async () => {
        behavior.BRASIL_API = 'error';

        await getCompany().expect(200);

        const profile = await prisma.companyProfile.findUniqueOrThrow({
          where: { cnpj: CNPJ },
          include: { cadastral_source: { select: { slug: true } } },
        });
        expect(profile.cadastral_source.slug).toBe('OPEN_CNPJ');
        expect(hits.filter((hit) => hit !== 'IBGE_CNAE')).toEqual([
          'BRASIL_API',
          'OPEN_CNPJ',
        ]);
      });

      it('todos os provedores sem o CNPJ: 404 COMPANY_NOT_FOUND, sem gravar', async () => {
        behavior.BRASIL_API = 'not-found';
        behavior.OPEN_CNPJ = 'not-found';
        behavior.MINHA_RECEITA = 'not-found';

        const response = await getCompany().expect(404);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'COMPANY_NOT_FOUND',
        );
        expect(await prisma.companyProfile.count()).toBe(0);
      });

      it('todos os provedores fora do ar: 503 COMPANY_DATA_UNAVAILABLE, sem gravar', async () => {
        behavior.BRASIL_API = 'error';
        behavior.OPEN_CNPJ = 'hang';
        behavior.MINHA_RECEITA = 'error';

        const response = await getCompany().expect(503);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'COMPANY_DATA_UNAVAILABLE',
        );
        expect(await prisma.companyProfile.count()).toBe(0);
      });

      it('um provedor sem o CNPJ e outro fora do ar: 503, e não "a empresa não existe"', async () => {
        behavior.BRASIL_API = 'not-found';
        behavior.OPEN_CNPJ = 'error';
        behavior.MINHA_RECEITA = 'not-found';

        await getCompany().expect(503);
      });

      it('cada chamada aos provedores e ao IBGE fica no log, com a origem "job sob demanda"', async () => {
        await getCompany().expect(200);

        const logs = await prisma.dataSourceRequestLog.findMany({
          include: { data_source: { select: { slug: true } } },
        });
        const bySource = new Map<string, number>();
        for (const { data_source } of logs) {
          bySource.set(
            data_source.slug,
            (bySource.get(data_source.slug) ?? 0) + 1,
          );
        }
        expect(Object.fromEntries(bySource)).toEqual({
          BRASIL_API: 1,
          IBGE_CNAE: 3,
        });
        expect(
          logs.every(
            ({ trigger, outcome }) =>
              trigger === RequestTrigger.ON_DEMAND_JOB &&
              outcome === RequestOutcome.SUCCESS,
          ),
        ).toBe(true);
      });
    });

    describe('IBGE', () => {
      it('as descrições ficam em cache: outra empresa com os mesmos CNAEs não consulta o IBGE de novo', async () => {
        await getCompany().expect(200);
        const ibgeAfterFirst = hits.filter((hit) => hit === 'IBGE_CNAE').length;

        await getCompany(OTHER_CNPJ).expect(200);

        expect(ibgeAfterFirst).toBe(3);
        expect(hits.filter((hit) => hit === 'IBGE_CNAE')).toHaveLength(3);
      });

      it('IBGE fora do ar: o cadastro é gravado com a descrição do provedor, e a rodada consulta o IBGE uma vez só', async () => {
        behavior.IBGE_CNAE = 'error';

        const response = await getCompany().expect(200);

        expect(response.body.main_cnae.description).toBe(
          'Desenvolvimento de programas de computador sob encomenda',
        );
        expect(hits.filter((hit) => hit === 'IBGE_CNAE')).toHaveLength(1);
      });

      it('IBGE lento demais: não impede de gravar o cadastro', async () => {
        behavior.IBGE_CNAE = 'hang';

        await getCompany().expect(200);

        expect(await prisma.companyProfile.count()).toBe(1);
      });
    });

    describe('histórico por hash de conteúdo', () => {
      it('cadastro que mudou: o hash anterior fica guardado', async () => {
        await getCompany().expect(200);
        const first = await prisma.companyProfile.findUniqueOrThrow({
          where: { cnpj: CNPJ },
        });
        await makeStale();
        legalName = 'ACME SERVICOS S.A.';

        await getCompany().expect(200);

        const second = await prisma.companyProfile.findUniqueOrThrow({
          where: { cnpj: CNPJ },
        });
        expect(second.legal_name).toBe('ACME SERVICOS S.A.');
        expect(second.content_hash).not.toBe(first.content_hash);
        expect(second.previous_content_hash).toBe(first.content_hash);
        expect(second.refreshed_at.getTime()).toBeGreaterThan(
          first.refreshed_at.getTime(),
        );
      });

      it('cadastro igual: o hash não muda e a data da atualização avança', async () => {
        await getCompany().expect(200);
        const first = await prisma.companyProfile.findUniqueOrThrow({
          where: { cnpj: CNPJ },
        });
        await makeStale();

        await getCompany().expect(200);

        const second = await prisma.companyProfile.findUniqueOrThrow({
          where: { cnpj: CNPJ },
        });
        expect(second.content_hash).toBe(first.content_hash);
        expect(second.previous_content_hash ?? null).toBeNull();
        expect(second.refreshed_at.getTime()).toBeGreaterThan(
          Date.now() - 60_000,
        );
      });

      it('trocar de provedor, com o mesmo cadastro, não muda o hash nem perde o código IBGE do município', async () => {
        await getCompany().expect(200);
        const first = await prisma.companyProfile.findUniqueOrThrow({
          where: { cnpj: CNPJ },
        });
        await makeStale();
        behavior.BRASIL_API = 'error';

        await getCompany().expect(200);

        const second = await prisma.companyProfile.findUniqueOrThrow({
          where: { cnpj: CNPJ },
          include: { cadastral_source: { select: { slug: true } } },
        });
        expect(second.cadastral_source.slug).toBe('OPEN_CNPJ');
        expect(second.content_hash).toBe(first.content_hash);
        expect(second.address.city_ibge_code).toBe('3550308');
      });

      it('com os provedores fora do ar, o cadastro vencido segue sendo servido', async () => {
        await getCompany().expect(200);
        await makeStale();
        behavior.BRASIL_API = 'error';
        behavior.OPEN_CNPJ = 'error';
        behavior.MINHA_RECEITA = 'error';

        const response = await getCompany().expect(200);

        expect(response.body.legal_name).toBe('ACME SERVICOS LTDA');
      });
    });

    describe('job malformado na fila', () => {
      async function waitForFailure(
        name: string,
        data: unknown,
      ): Promise<string | undefined> {
        const queue = new Queue(QueueName.COMPANY_PROFILE, {
          connection: { url: REDIS_URL },
        });

        try {
          const job = await queue.add(name, data, { attempts: 3 });
          let reason: string | undefined;

          await vi.waitFor(
            async () => {
              const current = await queue.getJob(job.id as string);

              expect(await current?.getState()).toBe('failed');
              reason = current?.failedReason;
              // Sem repetição: o consumidor marcou o erro como irrecuperável.
              expect(current?.attemptsMade).toBe(1);
            },
            { timeout: 10_000, interval: 100 },
          );

          return reason;
        } finally {
          await queue.close();
        }
      }

      it('nome de job desconhecido falha de uma vez, sem repetir', async () => {
        await expect(
          waitForFailure('outra-coisa', { cnpj: CNPJ }),
        ).resolves.toMatch(/Job desconhecido/);
      });

      it('CNPJ inválido falha de uma vez, sem consultar nenhum provedor', async () => {
        await expect(
          waitForFailure('fetch-company-profile', { cnpj: '11222333000182' }),
        ).resolves.toMatch(/CNPJ canônico válido/);

        expect(hits).toHaveLength(0);
      });
    });
  },
);
