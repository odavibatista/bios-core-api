import type { INestApplication } from '@nestjs/common';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { CompanyIndexEvolutionResponseSchema } from '@modules/environmental-intelligence/domain/dtos/requests/company-index-evolution.dto.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { IBAMA_DATASET_URLS } from '@modules/ibama/domain/ibama-evidence.mapper.js';
import { CalculateCompanyOdsScoresUseCase } from '@modules/scoring/infra/usecases/calculate-company-ods-scores.usecase.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import request from 'supertest';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { testRedisUrl } from '../support/infrastructure.js';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';

const CNPJ = '11222333000181';
const collections = [
  'company_ods_scores',
  'company_movements',
  'evidence_normalized',
  'evidence_raw',
  'evidence_collection_clocks',
  'company_profile',
];

/** RF36 ponta a ponta: evidências e índice gravados, série calculada na leitura. */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Evolução do índice por empresa (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let record: RecordEvidenceCollectionUseCase;
    let calculate: CalculateCompanyOdsScoresUseCase;
    let token: string;

    const get = (cnpj = CNPJ) =>
      request(app.getHttpServer())
        .get(`/companies/${cnpj}/index-evolution`)
        .set('Authorization', `Bearer ${token}`);

    async function saveProfile(legalNatureCode: string | null) {
      const source = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: 'BRASIL_API' },
      });

      await prisma.companyProfile.create({
        data: {
          cnpj: CNPJ,
          cadastral_source_id: source.id_data_source,
          legal_name: 'EMPRESA DE TESTE LTDA',
          registration_status: 'ATIVA',
          legal_nature_code: legalNatureCode,
          address: { city: 'São Paulo', uf: 'SP' },
          main_cnae: { code: '6201501', description: 'Software' },
          secondary_cnaes: [],
          content_hash: 'a'.repeat(64),
          refreshed_at: new Date(),
        },
      });
    }

    async function saveInfractions(...dates: string[]) {
      await record.execute({
        cnpj: CNPJ,
        sourceSlug: 'IBAMA',
        result: {
          status: 'COLLECTED',
          findings: dates.map((date, index) => ({
            reference: `AI-${index}`,
            url: IBAMA_DATASET_URLS.AUTO_INFRACAO,
            publishedAt: new Date(date),
          })),
        },
      });
      await calculate.execute(CNPJ);
    }

    const odsCount = () => prisma.companyOdsScore.count();

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      record = app.get(RecordEvidenceCollectionUseCase, { strict: false });
      calculate = app.get(CalculateCompanyOdsScoresUseCase, { strict: false });
      await prisma.seed(CATALOG_SEEDERS);

      const account = await createTestAccount(app);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);

      token = (login.body as { access_token: string }).access_token;
    });

    beforeEach(async () => {
      await prisma.reset(collections);
      await resetThrottleCounters(testRedisUrl());
    });

    afterAll(async () => {
      await prisma.reset(collections);
      await prisma.reset(['users', 'user_sessions', 'login_attempts']);
      await app.close();
    });

    it('devolve os degraus, e o último reproduz o índice gravado, sem gravar nada', async () => {
      await saveProfile('2062');
      await saveInfractions(
        '2022-06-01T00:00:00.000Z',
        '2024-03-10T00:00:00.000Z',
      );
      const before = await odsCount();

      const { body } = await get().expect(200);
      const { ods, reconstructed } =
        CompanyIndexEvolutionResponseSchema.parse(body);
      const series = ods.find(({ ods_number }) => ods_number === 15);
      const stored = await prisma.companyOdsScore.findFirstOrThrow({
        where: { cnpj: CNPJ, score_value: { not: null } },
      });

      expect(reconstructed).toBe(true);
      expect(series?.status).toBe('AVAILABLE');
      expect(series?.steps.map(({ score_value }) => score_value)).toEqual([
        -40, -80,
      ]);
      expect(series?.steps.at(-1)?.score_value).toBe(stored.score_value);
      expect(series?.steps[1]?.evidence).toMatchObject({
        source_slug: 'IBAMA',
        source_reference: 'AI-1',
      });
      expect(await odsCount()).toBe(before);
    });

    it('empresário individual não tem série', async () => {
      await saveProfile('2135');
      await saveInfractions(
        '2022-06-01T00:00:00.000Z',
        '2024-03-10T00:00:00.000Z',
      );

      const { body } = await get().expect(200);
      const { ods } = CompanyIndexEvolutionResponseSchema.parse(body);

      expect(ods.length).toBeGreaterThan(0);
      for (const { status, steps } of ods) {
        expect(status).toBe('INDIVIDUAL_ENTREPRENEUR');
        expect(steps).toEqual([]);
      }
    });

    it('natureza desconhecida não mostra a curva', async () => {
      await saveProfile(null);
      await saveInfractions(
        '2022-06-01T00:00:00.000Z',
        '2024-03-10T00:00:00.000Z',
      );

      const { body } = await get().expect(200);

      expect(
        CompanyIndexEvolutionResponseSchema.parse(body).ods.map(
          ({ status }) => status,
        ),
      ).toContain('LEGAL_NATURE_PENDING');
    });

    it('evidências em um só ano explicam a ausência', async () => {
      await saveProfile('2062');
      await saveInfractions('2024-03-10T00:00:00.000Z');

      const { body } = await get().expect(200);
      const { ods } = CompanyIndexEvolutionResponseSchema.parse(body);

      expect(ods.find(({ ods_number }) => ods_number === 15)).toMatchObject({
        status: 'SHORT_HISTORY',
        steps: [],
      });
    });

    it('exige sessão, recusa CNPJ inválido e responde 404 sem cadastro', async () => {
      await request(app.getHttpServer())
        .get(`/companies/${CNPJ}/index-evolution`)
        .expect(401);
      await get('invalido').expect(422);
      await get().expect(404);
    });
  },
);
