import type { INestApplication } from '@nestjs/common';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { CompanyFullProfileResponseSchema } from '@modules/environmental-intelligence/domain/dtos/requests/company-full-profile.dto.js';
import { API_KEY_HEADER } from '@shared/config/throttler.config.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { QueueProvider } from '@shared/domain/providers/queue.provider.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import request from 'supertest';
import { inject } from 'vitest';
import { resetCache } from '../support/cache.js';
import { buildDistinctCnpjs } from '../support/cnpj.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';
import { testRedisUrl } from '../support/infrastructure.js';

const REDIS_URL = testRedisUrl();

/** Quantos CNPJs distintos a rajada do integrador consulta. */
const BURST = 8;

/** O que a aplicação pediu à fila, sem deixar nenhum consumidor falar com as fontes. */
interface PublishedJob {
  queue: string;
  name: string;
  jobId?: string;
}

/**
 * Carga que a API pública (UC12) gera quando um integrador varre CNPJs (#333, NFPD01).
 *
 * A fila é trocada por um registro: o que se afirma aqui é **quantos jobs a rajada publica** e
 * que nenhum deles é esperado pela requisição, sem que os consumidores baixem dumps nem
 * consultem as fontes. O cadastro é gravado direto, dentro da validade.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Carga da API pública sobre fontes e filas (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let accessToken: string;
    let apiKey: string;
    let published: PublishedJob[];
    let awaited: PublishedJob[];

    beforeAll(async () => {
      published = [];
      awaited = [];

      ({ app, prisma } = await createDatabaseTestingApp((builder) => {
        builder.overrideProvider(QueueProvider).useValue({
          enqueue: (
            queue: string,
            name: string,
            _payload: unknown,
            options?: { jobId?: string },
          ) => {
            published.push({ queue, name, jobId: options?.jobId });

            return Promise.resolve();
          },
          enqueueAndWait: (
            queue: string,
            name: string,
            _payload: unknown,
            options?: { jobId?: string },
          ) => {
            awaited.push({ queue, name, jobId: options?.jobId });

            return Promise.reject(new Error('a API pública não deve esperar'));
          },
          schedule: () => Promise.resolve(),
          unschedule: () => Promise.resolve(),
        });
      }));
      await prisma.seed(CATALOG_SEEDERS);

      const account = await createTestAccount(app);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);

      accessToken = login.body.access_token as string;
      apiKey = (
        await request(app.getHttpServer())
          .post('/api-keys')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ name: 'Varredura' })
          .expect(201)
      ).body.key as string;
    });

    beforeEach(async () => {
      published.length = 0;
      awaited.length = 0;
      await resetThrottleCounters(REDIS_URL);
      await resetCache(REDIS_URL);
      await prisma.reset([
        'company_profile',
        'evidence_raw',
        'evidence_normalized',
      ]);
    });

    afterAll(async () => {
      await prisma.reset([
        'users',
        'user_sessions',
        'login_attempts',
        'api_keys',
        'company_profile',
        'evidence_raw',
        'evidence_normalized',
      ]);
      await app.close();
    });

    async function saveCompanies(cnpjs: string[]): Promise<void> {
      const source = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: 'BRASIL_API' },
      });

      await prisma.companyProfile.createMany({
        data: cnpjs.map((cnpj, index) => ({
          cnpj,
          cadastral_source_id: source.id_data_source,
          legal_name: `EMPRESA ${index} LTDA`,
          registration_status: 'ATIVA',
          company_size: 'DEMAIS',
          address: { city: 'São Paulo', uf: 'SP' },
          main_cnae: { code: '6201501', description: 'Desenvolvimento' },
          secondary_cnaes: [],
          content_hash: `hash-${index}`,
          refreshed_at: new Date(),
        })),
      });
    }

    const getPublic = (cnpj: string) =>
      request(app.getHttpServer())
        .get(`/v1/companies/${cnpj}`)
        .set(API_KEY_HEADER, apiKey);

    const countBy = (queue: string) =>
      published.filter((job) => job.queue === queue).length;

    it('uma rajada de CNPJs distintos publica um job por fonte e por CNPJ, e nenhum é esperado', async () => {
      const cnpjs = buildDistinctCnpjs(BURST);
      await saveCompanies(cnpjs);

      for (const cnpj of cnpjs) {
        await getPublic(cnpj).expect(200);
      }

      expect(awaited).toEqual([]);
      expect(countBy(QueueName.ENVIRONMENTAL_EVIDENCES)).toBe(BURST);
      expect(countBy(QueueName.GHG_INVENTORY)).toBe(BURST);
      expect(countBy(QueueName.IBAMA_INGESTION)).toBe(BURST);
      expect(countBy(QueueName.ODS_SCORING)).toBe(BURST);
      expect(published).toHaveLength(BURST * 4);
    });

    it('responde sem esperar as fontes e marca o que está pendente', async () => {
      const [cnpj] = buildDistinctCnpjs(1);
      await saveCompanies([cnpj]);

      const started = performance.now();
      const response = await getPublic(cnpj).expect(200);
      const elapsed = performance.now() - started;
      const profile = CompanyFullProfileResponseSchema.parse(response.body);

      expect(elapsed).toBeLessThan(2_000);
      expect(profile.provenance.sources).toEqual([
        expect.objectContaining({ source_slug: 'IBAMA', origin: 'PENDING' }),
        expect.objectContaining({ source_slug: 'CGU_CEIS', origin: 'PENDING' }),
        expect.objectContaining({ source_slug: 'CGU_CNEP', origin: 'PENDING' }),
        expect.objectContaining({
          source_slug: 'GHG_PROTOCOL',
          origin: 'PENDING',
        }),
      ]);
      expect(profile.provenance.scores_pending).toBe(true);
      expect(profile.provenance.retry_after_seconds).toBe(30);
      expect(
        profile.ods_scores.every(
          ({ calculation_status }) => calculation_status === 'PENDING',
        ),
      ).toBe(true);
    });

    it('repetir a consulta não republica as coletas enquanto o marcador vale; o recálculo é coalescido', async () => {
      const cnpjs = buildDistinctCnpjs(3);
      await saveCompanies(cnpjs);

      for (const cnpj of cnpjs) await getPublic(cnpj).expect(200);
      const firstRound = published.length;

      for (const cnpj of cnpjs) await getPublic(cnpj).expect(200);
      const second = published.slice(firstRound);

      expect(
        second.filter((job) => job.queue !== QueueName.ODS_SCORING),
      ).toEqual([]);
      // O recálculo é pedido de novo, mas com o mesmo identificador por CNPJ (coalescido).
      expect(second.every((job) => job.queue === QueueName.ODS_SCORING)).toBe(
        true,
      );
      expect(new Set(second.map((job) => job.jobId)).size).toBe(cnpjs.length);
    });

    it('o painel continua esperando as coletas: a mudança é só da rota pública', async () => {
      const [cnpj] = buildDistinctCnpjs(1);
      await saveCompanies([cnpj]);

      await request(app.getHttpServer())
        .get(`/companies/${cnpj}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // O painel espera o CGU, o GHG e o recálculo (o registro rejeita a espera, e a
      // consulta degrada: o que se afirma é que ela foi tentada).
      const waitedQueues = awaited.map((job) => job.queue);

      expect(waitedQueues).toEqual(
        expect.arrayContaining([
          QueueName.ENVIRONMENTAL_EVIDENCES,
          QueueName.GHG_INVENTORY,
          QueueName.ODS_SCORING,
        ]),
      );
    });
  },
);
