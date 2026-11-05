import { appendFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { CompanyAnalyticsResponseSchema } from '@modules/companies/domain/dtos/requests/company-analytics.dto.js';
import { GetCompanyAnalyticsUseCase } from '@modules/companies/infra/usecases/get-company-analytics.usecase.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import request from 'supertest';
import { inject } from 'vitest';
import { resetCache } from '../support/cache.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { testRedisUrl } from '../support/infrastructure.js';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';

const REDIS_URL = testRedisUrl();
const collections = [
  'company_ods_scores',
  'evidence_normalized',
  'company_profile',
];

/** NFDE03: o requisito fala em base de ao menos 100 mil empresas. */
const COMPANIES = 100_000;
const BATCH = 10_000;
const MAX_MS = 2_000;

const cnpjOf = (index: number) => String(index).padStart(14, '0');

/** UC19 ponta a ponta (RF37): os agregados sobre o MongoDB real. */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Panorama de dados (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let sourceId: string;
    let odsId: string;
    let accessToken: string;

    const get = (query: Record<string, string | number> = {}) =>
      request(app.getHttpServer())
        .get('/companies/analytics')
        .query(query)
        .set('Authorization', `Bearer ${accessToken}`);

    const profile = (cnpj: string, uf: string) => ({
      cnpj,
      cadastral_source_id: sourceId,
      legal_name: `EMPRESA ${cnpj}`,
      registration_status: 'ATIVA',
      company_size: 'DEMAIS',
      legal_nature_code: '2062',
      legal_nature: 'Sociedade Empresária Limitada',
      address: { city: 'CIDADE', uf },
      main_cnae: { code: '4711301', description: 'Varejo' },
      secondary_cnaes: [],
      content_hash: 'a'.repeat(64),
      refreshed_at: new Date(),
    });

    const score = (cnpj: string, value: number | null) => ({
      cnpj,
      ods_id: odsId,
      ods_number: 15,
      score_value: value,
      confidence_value: value === null ? 0 : 0.5,
      evidence_count: value === null ? 0 : 1,
      contributions: [],
      rules_version: 'rf10-rf11-v3',
      calculated_at: new Date(),
    });

    const evidence = (cnpj: string, index: number) => ({
      evidence_key: `IBAMA:${cnpj}:${index}`,
      cnpj,
      data_source_id: sourceId,
      ods_id: odsId,
      category: 'INFRACAO_AMBIENTAL' as const,
      state: 'CONFIRMED' as const,
      signal: 'NEGATIVE' as const,
      details: {
        biomes: 'Amazonia, Cerrado',
        infraction_type: 'Flora',
        fine_amount: 1000,
        area_hectares: 2,
      },
      published_at: new Date('2024-05-10T00:00:00.000Z'),
      collected_at: new Date(),
      valid_until: new Date('2099-01-01T00:00:00.000Z'),
    });

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      await prisma.seed(CATALOG_SEEDERS);
      sourceId = (
        await prisma.dataSource.findUniqueOrThrow({
          where: { slug: 'BRASIL_API' },
        })
      ).id_data_source;
      odsId = (
        await prisma.ods.findUniqueOrThrow({ where: { ods_number: 15 } })
      ).id_ods;

      const account = await createTestAccount(app);
      const { body } = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);

      accessToken = body.access_token as string;
    });

    beforeEach(async () => {
      await prisma.reset(collections);
      await resetCache(REDIS_URL);
      await resetThrottleCounters(REDIS_URL);
    });

    afterAll(async () => {
      await prisma.reset(collections);
      await prisma.reset(['users', 'user_sessions', 'login_attempts']);
      await app.close();
    });

    it('soma o conjunto e não mistura empresas de fora dele', async () => {
      const inside = Array.from({ length: 6 }, (_, index) => cnpjOf(index + 1));
      const outside = cnpjOf(50);

      await prisma.companyProfile.createMany({
        data: [
          ...inside.map((cnpj) => profile(cnpj, 'SP')),
          profile(outside, 'PA'),
        ],
      });
      await prisma.companyOdsScore.createMany({
        data: [...inside.map((cnpj) => score(cnpj, -40)), score(outside, -100)],
      });
      await prisma.evidenceNormalized.createMany({
        data: [evidence(inside[0], 1), evidence(outside, 2)],
      });

      const { body } = await get({ uf: 'SP' }).expect(200);
      const analytics = CompanyAnalyticsResponseSchema.parse(body);

      expect(analytics.companies).toBe(6);
      expect(analytics.totals).toEqual({
        confirmed_evidences: 1,
        fine_notices: 1,
        fine_amount: 1000,
        area_hectares: 2,
      });
      expect(analytics.registration.uf).toEqual([
        { key: 'SP', label: 'SP', count: 6 },
      ]);
      expect(analytics.evidence.biome.map(({ key }) => key)).toEqual([
        'Amazonia',
        'Cerrado',
      ]);
      expect(analytics.evidence.year).toEqual([{ year: 2024, count: 1 }]);
      expect(analytics.ods[0]).toMatchObject({
        ods_number: 15,
        companies_with_index: 6,
        average_score: -40,
      });
    });

    it('sem critério responde a base, ignorando evidência sem perfil', async () => {
      await prisma.companyProfile.create({
        data: profile(cnpjOf(1), 'SP'),
      });
      await prisma.evidenceNormalized.createMany({
        data: [evidence(cnpjOf(1), 1), evidence(cnpjOf(2), 2)],
      });

      const { body } = await get().expect(200);

      expect(body).toMatchObject({
        companies: 1,
        totals: { confirmed_evidences: 1 },
      });
    });

    it('recorte pequeno omite médias e faixas e mantém as contagens', async () => {
      await prisma.companyProfile.create({ data: profile(cnpjOf(1), 'SP') });
      await prisma.companyOdsScore.create({ data: score(cnpjOf(1), -40) });

      const { body } = await get({ uf: 'SP' }).expect(200);
      const [ods] = CompanyAnalyticsResponseSchema.parse(body).ods;

      expect(ods).toMatchObject({
        companies_with_index: 1,
        average_score: null,
        score_ranges: [],
      });
    });

    it('índice nulo não entra nas médias nem nas faixas (IND02)', async () => {
      const cnpjs = Array.from({ length: 6 }, (_, index) => cnpjOf(index + 1));

      await prisma.companyProfile.createMany({
        data: cnpjs.map((cnpj) => profile(cnpj, 'SP')),
      });
      await prisma.companyOdsScore.createMany({
        data: cnpjs.map((cnpj, index) => score(cnpj, index === 0 ? null : -40)),
      });

      const { body } = await get({ uf: 'SP' }).expect(200);
      const [ods] = CompanyAnalyticsResponseSchema.parse(body).ods;

      expect(ods).toMatchObject({
        companies: 6,
        companies_with_index: 5,
        average_score: -40,
        average_confidence: 0.5,
      });
      expect(
        ods?.score_ranges.reduce((total, { count }) => total + count, 0),
      ).toBe(5);
    });

    it('exige sessão, valida os critérios e não colide com a consulta por CNPJ', async () => {
      await request(app.getHttpServer())
        .get('/companies/analytics')
        .expect(401);
      await get({ min_score: 10 }).expect(422);
      await get({ ods: 99 }).expect(422);
      await get().expect(200);
    });

    it(`responde em até ${MAX_MS} ms sobre ${COMPANIES} empresas (NFDE03)`, async () => {
      for (let start = 0; start < COMPANIES; start += BATCH) {
        const cnpjs = Array.from({ length: BATCH }, (_, index) =>
          cnpjOf(start + index + 1),
        );

        await prisma.companyProfile.createMany({
          data: cnpjs.map((cnpj, index) =>
            profile(cnpj, index % 2 ? 'SP' : 'PA'),
          ),
        });
        await prisma.companyOdsScore.createMany({
          data: cnpjs.map((cnpj) => score(cnpj, -40)),
        });
        await prisma.evidenceNormalized.createMany({
          data: cnpjs.map((cnpj, index) => evidence(cnpj, index)),
        });
      }

      const useCase = app.get(GetCompanyAnalyticsUseCase, { strict: false });
      const timed = async (query: Parameters<typeof useCase.execute>[0]) => {
        const started = performance.now();

        await useCase.execute(query);

        return performance.now() - started;
      };
      const whole = await timed({});
      const cached = await timed({});
      const uf = await timed({ uf: 'SP' });
      const name = await timed({ name: 'EMPRESA' });

      if (process.env.ANALYTICS_REPORT) {
        appendFileSync(
          process.env.ANALYTICS_REPORT,
          `base ${whole.toFixed(0)} ms, cache ${cached.toFixed(1)} ms, UF ${uf.toFixed(0)} ms, nome ${name.toFixed(0)} ms\n`,
        );
      }

      expect(cached).toBeLessThan(whole);
      expect(uf).toBeLessThan(MAX_MS);
    }, 180_000);
  },
);
