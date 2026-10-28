import type { INestApplication } from '@nestjs/common';
import { inject } from 'vitest';
import request from 'supertest';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { CompanyFullProfileResponseSchema } from '@modules/environmental-intelligence/domain/dtos/requests/company-full-profile.dto.js';
import { GetCompanyEnvironmentalEvidencesUseCase } from '@modules/environmental-intelligence/infra/usecases/get-company-environmental-evidences.usecase.js';
import { groupCompanyEvidences } from '@modules/evidences/domain/company-environmental-evidences.dto.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { IBAMA_DATASET_URLS } from '@modules/ibama/domain/ibama-evidence.mapper.js';
import { RequestScoreRecalculationUseCase } from '@modules/scoring/infra/usecases/request-score-recalculation.usecase.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { resetCache } from '../support/cache.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';
import { faker } from '../support/faker.js';
import { testRedisUrl } from '../support/infrastructure.js';

const REDIS_URL = testRedisUrl();
const CNPJ = '11222333000181';
const collections = [
  'company_ods_scores',
  'evidence_normalized',
  'evidence_raw',
  'company_profile',
  'data_source_request_logs',
  'ingestion_runs',
  'data_sources',
  'ods',
  'users',
  'user_sessions',
  'login_attempts',
];

/**
 * Perfil completo (UC06 + UC07) no Mongo e no Redis reais: cadastro, evidências e índices
 * por ODS na mesma resposta. Só a coleta nas fontes externas é trocada por uma leitura do
 * que já está gravado (com o recálculo real pela fila de scoring), para o teste não
 * depender de rede; cada fonte tem os seus próprios testes.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Perfil completo da empresa (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let record: RecordEvidenceCollectionUseCase;
    let recalculate: RequestScoreRecalculationUseCase;
    let accessToken: string;
    let collectionRuns = 0;
    let stallCollection = false;

    const getProfile = (cnpj = CNPJ) =>
      request(app.getHttpServer())
        .get(`/companies/${cnpj}`)
        .set('Authorization', `Bearer ${accessToken}`);

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp((builder) => {
        builder
          .overrideProvider(GetCompanyEnvironmentalEvidencesUseCase)
          .useFactory({
            inject: [
              ListCompanyEvidencesUseCase,
              RequestScoreRecalculationUseCase,
            ],
            factory: (
              list: ListCompanyEvidencesUseCase,
              scores: RequestScoreRecalculationUseCase,
            ) => ({
              execute: async (cnpj: string) => {
                collectionRuns += 1;
                if (stallCollection) await new Promise<void>(() => undefined);
                await scores.execute({ cnpj, wait: true });

                return groupCompanyEvidences(cnpj, await list.execute(cnpj));
              },
            }),
          });
      }));
      record = app.get(RecordEvidenceCollectionUseCase, { strict: false });
      recalculate = app.get(RequestScoreRecalculationUseCase, {
        strict: false,
      });
    });

    beforeEach(async () => {
      collectionRuns = 0;
      stallCollection = false;
      await prisma.reset(collections);
      await prisma.seed(CATALOG_SEEDERS);
      await resetCache(REDIS_URL);
      await resetThrottleCounters(REDIS_URL);
      const source = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: 'BRASIL_API' },
      });
      await prisma.companyProfile.create({
        data: {
          cnpj: CNPJ,
          cadastral_source_id: source.id_data_source,
          legal_name: faker.company.name(),
          trade_name: faker.company.name(),
          registration_status: 'ATIVA',
          company_size: 'DEMAIS',
          address: {
            street: 'Avenida Paulista',
            number: '1578',
            neighborhood: 'Bela Vista',
            city: 'São Paulo',
            city_ibge_code: '3550308',
            uf: 'SP',
            zipcode: '01310200',
          },
          main_cnae: {
            code: '6201501',
            description: 'Desenvolvimento de software',
          },
          secondary_cnaes: [],
          content_hash: faker.string.hexadecimal({ length: 64, prefix: '' }),
          refreshed_at: new Date(),
        },
      });
      const account = await createTestAccount(app);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);
      accessToken = (login.body as { access_token: string }).access_token;
    });

    afterAll(async () => {
      await prisma.reset(collections);
      await resetCache(REDIS_URL);
      await app.close();
    });

    it('exige sessão e valida o CNPJ', async () => {
      await request(app.getHttpServer()).get(`/companies/${CNPJ}`).expect(401);
      await getProfile('cnpj-invalido').expect(422);
    });

    it('empresa sem evidências: cadastro na raiz, categorias vazias e os dois ODS calculados sem nota', async () => {
      const response = await getProfile().expect(200);
      const profile = CompanyFullProfileResponseSchema.parse(response.body);

      expect(profile).toMatchObject({
        cnpj: CNPJ,
        registration_status: 'ATIVA',
      });
      expect(
        profile.evidences.every((group) => group.evidences.length === 0),
      ).toBe(true);
      expect(profile.ods_scores.map((item) => item.ods_number)).toEqual([
        13, 15,
      ]);
      for (const item of profile.ods_scores) {
        expect(item).toMatchObject({
          calculation_status: 'CALCULATED',
          index_status: 'UNAVAILABLE',
          score_value: null,
          coverage_status: 'NO_DATA',
          contributions: [],
        });
      }
    });

    it('distingue ausência confirmada de fonte indisponível na proveniência', async () => {
      await record.execute({
        cnpj: CNPJ,
        sourceSlug: 'CGU_CEIS',
        result: { status: 'COLLECTED', findings: [] },
      });
      await record.execute({
        cnpj: CNPJ,
        sourceSlug: 'CGU_CNEP',
        result: { status: 'UNAVAILABLE' },
      });

      const profile = CompanyFullProfileResponseSchema.parse(
        (await getProfile().expect(200)).body,
      );
      expect(profile.provenance.sources).toContainEqual({
        source_slug: 'CGU_CEIS',
        origin: 'PERSISTED',
        evidence_state: 'NOT_FOUND',
      });
      expect(profile.provenance.sources).toContainEqual({
        source_slug: 'CGU_CNEP',
        origin: 'UNAVAILABLE',
        evidence_state: 'UNKNOWN',
      });
      expect(profile.provenance.retry_after_seconds).toBe(900);
    });

    it('com evidências confirmadas: traz fonte, índice, confiança e explicação por ODS, sem combiná-los', async () => {
      await record.execute({
        cnpj: CNPJ,
        sourceSlug: 'IBAMA',
        result: {
          status: 'COLLECTED',
          findings: [
            { reference: 'AI-001', url: IBAMA_DATASET_URLS.AUTO_INFRACAO },
          ],
        },
      });

      const response = await getProfile().expect(200);
      const profile = CompanyFullProfileResponseSchema.parse(response.body);
      const confirmed = profile.evidences.flatMap((group) => group.evidences);
      const land = profile.ods_scores.find((item) => item.ods_number === 15);
      const climate = profile.ods_scores.find((item) => item.ods_number === 13);

      expect(confirmed).toHaveLength(1);
      expect(confirmed[0]).toMatchObject({
        source_slug: 'IBAMA',
        state: 'CONFIRMED',
        source_reference: 'AI-001',
      });
      expect(land).toMatchObject({
        calculation_status: 'CALCULATED',
        index_status: 'AVAILABLE',
        evidence_count: 1,
      });
      expect(land?.score_value).toBeLessThan(0);
      expect(land?.confidence_value).toBeGreaterThan(0);
      expect(land?.contributions).toHaveLength(1);
      expect(
        land?.contributions.reduce((sum, item) => sum + item.points, 0),
      ).toBe(land?.score_value);
      expect(climate).toMatchObject({
        index_status: 'UNAVAILABLE',
        score_value: null,
      });
      expect(response.body).not.toHaveProperty('general_score');
      expect(JSON.stringify(response.body)).not.toMatch(/sustent[aá]vel/i);
    });

    it('a explicação embutida é a mesma da rota de explicação do ODS', async () => {
      await record.execute({
        cnpj: CNPJ,
        sourceSlug: 'IBAMA',
        result: {
          status: 'COLLECTED',
          findings: [
            { reference: 'AI-001', url: IBAMA_DATASET_URLS.AUTO_INFRACAO },
          ],
        },
      });

      const profile = CompanyFullProfileResponseSchema.parse(
        (await getProfile().expect(200)).body,
      );
      const explanation = await request(app.getHttpServer())
        .get(`/companies/${CNPJ}/scores/15/explanation`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const standalone = { ...(explanation.body as Record<string, unknown>) };
      delete standalone.cnpj;
      const land = profile.ods_scores.find((item) => item.ods_number === 15);

      expect(land).toMatchObject(standalone);
    });

    it('a segunda consulta vem do cache; o recálculo do índice o apaga', async () => {
      await record.execute({
        cnpj: CNPJ,
        sourceSlug: 'IBAMA',
        result: {
          status: 'COLLECTED',
          findings: [
            { reference: 'AI-001', url: IBAMA_DATASET_URLS.AUTO_INFRACAO },
          ],
        },
      });

      const first = await getProfile().expect(200);
      const second = await getProfile().expect(200);

      expect(second.body).toEqual(first.body);
      expect(collectionRuns).toBe(1);

      await recalculate.execute({ cnpj: CNPJ, wait: true });
      await getProfile().expect(200);

      expect(collectionRuns).toBe(2);
    });

    it('responde com retrato parcial e proveniência dentro do orçamento quando a coleta não conclui', async () => {
      stallCollection = true;
      const start = performance.now();
      const response = await getProfile().expect(200);
      const elapsed = performance.now() - start;
      const profile = CompanyFullProfileResponseSchema.parse(response.body);

      console.info(`Perfil degradado: ${elapsed.toFixed(0)} ms`);
      expect(elapsed).toBeLessThan(15_000);
      expect(profile.provenance.retry_after_seconds).toBe(30);
      expect(profile.provenance.scores_pending).toBe(true);
      expect(profile.provenance.sources).toHaveLength(4);
      expect(
        profile.provenance.sources.every(
          (source) =>
            source.origin === 'PENDING' && source.evidence_state === null,
        ),
      ).toBe(true);
      expect(profile.ods_scores).toHaveLength(2);
      expect(collectionRuns).toBe(1);
    }, 20_000);

    it('perfil com cache cheio cumpre o prazo de 2 segundos', async () => {
      await getProfile().expect(200);
      const start = performance.now();
      await getProfile().expect(200);
      const elapsed = performance.now() - start;
      console.info(`Perfil em cache: ${elapsed.toFixed(0)} ms`);
      expect(elapsed).toBeLessThan(2_000);
      expect(collectionRuns).toBe(1);
    });

    it('aceita 60 consultas por minuto (limite próprio, #335) e recusa a seguinte com 429', async () => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await getProfile().expect(200);
      }

      const response = await getProfile().expect(429);

      expect(response.body).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    });
  },
);
