import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { inject } from 'vitest';
import request from 'supertest';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { IBAMA_DATASET_URLS } from '@modules/ibama/domain/ibama-evidence.mapper.js';
import { ScoreExplanationResponseSchema } from '@modules/scoring/domain/dtos/requests/score-explanation.dto.js';
import { CalculateCompanyOdsScoresUseCase } from '@modules/scoring/infra/usecases/calculate-company-ods-scores.usecase.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';

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

describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'RF12: explicacao autenticada do score no Mongo real',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let record: RecordEvidenceCollectionUseCase;
    let calculate: CalculateCompanyOdsScoresUseCase;
    let token: string;
    const route = (ods = '15', cnpj = CNPJ) =>
      `/companies/${cnpj}/scores/${ods}/explanation`;
    const get = (ods = '15', cnpj = CNPJ) =>
      request(app.getHttpServer())
        .get(route(ods, cnpj))
        .set('Authorization', `Bearer ${token}`);

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      record = app.get(RecordEvidenceCollectionUseCase, { strict: false });
      calculate = app.get(CalculateCompanyOdsScoresUseCase, {
        strict: false,
      });
    });
    beforeEach(async () => {
      await prisma.reset(collections);
      await prisma.seed(CATALOG_SEEDERS);
      await resetThrottleCounters(inject('testRedisUrl'));
      const account = await createTestAccount(app);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);
      token = (login.body as { access_token: string }).access_token;
    });
    afterAll(async () => {
      await prisma.reset(collections);
      await app.close();
    });

    it('exige JWT, valida parâmetros e responde 404 se não há score', async () => {
      await request(app.getHttpServer()).get(route()).expect(401);
      await get('abc').expect(422);
      await get('15', 'cnpj-invalido').expect(422);
      const missing = await get().expect(404);
      expect(missing.body).toMatchObject({ code: 'SCORE_NOT_FOUND' });
    });

    it('índice nulo retorna lista vazia, confiança separada e nenhuma coleta', async () => {
      await calculate.execute(CNPJ);
      const response = await get().expect(200);
      expect(ScoreExplanationResponseSchema.parse(response.body)).toMatchObject(
        {
          ods_number: 15,
          index_status: 'UNAVAILABLE',
          score_value: null,
          confidence_value: 0,
          contributions: [],
        },
      );
      expect(await prisma.dataSourceRequestLog.count()).toBe(0);
    });

    it('expõe fontes, estados, sinais, pesos e pontos para cada ODS sem misturá-los', async () => {
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
      await record.execute({
        cnpj: CNPJ,
        sourceSlug: 'CGU_CEIS',
        result: {
          status: 'COLLECTED',
          findings: [
            {
              reference: '370679',
              url: 'https://api.portaldatransparencia.gov.br/api-de-dados/ceis/370679',
            },
          ],
        },
      });
      await record.execute({
        cnpj: CNPJ,
        sourceSlug: 'CGU_CNEP',
        result: { status: 'COLLECTED', findings: [] },
      });
      await record.execute({
        cnpj: CNPJ,
        sourceSlug: 'GHG_PROTOCOL',
        result: {
          status: 'COLLECTED',
          findings: [
            {
              reference: '5091/19',
              url: 'https://sistema-registropublicodeemissoesapi.fgv.br/GenerateReport/GenerateInventoryReport/5091/19/true',
            },
          ],
        },
      });
      await calculate.execute(CNPJ);

      const climate = ScoreExplanationResponseSchema.parse(
        (await get('13').expect(200)).body,
      );
      const land = ScoreExplanationResponseSchema.parse(
        (await get('15').expect(200)).body,
      );
      expect(climate).toMatchObject({
        score_value: 60,
        index_status: 'AVAILABLE',
        evidence_count: 1,
        contributions: [
          {
            evidence: { source_slug: 'GHG_PROTOCOL', state: 'CONFIRMED' },
            signal: 'POSITIVE',
            weight: 60,
            points: 60,
          },
        ],
      });
      expect(land).toMatchObject({
        score_value: -45,
        index_status: 'AVAILABLE',
        evidence_count: 2,
      });
      expect(
        land.contributions.map((item) => [
          item.evidence.category,
          item.signal,
          item.weight,
          item.points,
        ]),
      ).toEqual([
        ['CONDUTA_ADMINISTRATIVA', 'NEGATIVE', 5, -5],
        ['INFRACAO_AMBIENTAL', 'NEGATIVE', 40, -40],
      ]);
      expect(
        land.contributions.reduce((sum, item) => sum + item.points, 0),
      ).toBe(land.score_value);
      expect(
        land.contributions.every(
          (item) => item.evidence.source_reference || item.evidence.source_url,
        ),
      ).toBe(true);
      expect(JSON.stringify(land)).not.toMatch(/sustent[aá]vel/i);
      expect(await prisma.dataSourceRequestLog.count()).toBe(0);
    });

    it('evidência vencida mostra estado atual sem apagar o estado do cálculo', async () => {
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
      await calculate.execute(CNPJ);
      await prisma.evidenceNormalized.updateMany({
        where: { cnpj: CNPJ, data_source: { slug: 'IBAMA' } },
        data: { valid_until: new Date(0) },
      });
      const result = ScoreExplanationResponseSchema.parse(
        (await get().expect(200)).body,
      );
      expect(result.contributions[0].evidence).toMatchObject({
        state: 'CONFIRMED',
        current_state: 'OUTDATED',
      });
    });

    it('evidência apagada gera 409 em vez de explicação incompleta', async () => {
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
      await calculate.execute(CNPJ);
      await prisma.evidenceNormalized.deleteMany({ where: { cnpj: CNPJ } });
      const response = await get().expect(409);
      expect(response.body).toMatchObject({ code: 'SCORE_EXPLANATION_STALE' });
    });

    it('OpenAPI declara autenticação, parâmetros e respostas auditáveis', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('BIOS')
          .addBearerAuth(undefined, 'jwt')
          .build(),
      );
      const operation =
        document.paths['/companies/{cnpj}/scores/{odsNumber}/explanation'].get!;
      expect(operation.security).toEqual([{ jwt: [] }]);
      for (const status of ['200', '401', '404', '409', '422', '429', '500'])
        expect(operation.responses).toHaveProperty(status);
      const response = JSON.stringify(operation.responses['200']);
      for (const field of [
        'index_status',
        'score_value',
        'confidence_value',
        'contributions',
        'evidence',
        'source',
        'source_reference',
        'current_state',
        'weight',
        'signal',
        'points',
      ])
        expect(response).toContain(field);
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'cnpj', in: 'path', required: true }),
          expect.objectContaining({
            name: 'odsNumber',
            in: 'path',
            required: true,
          }),
        ]),
      );
    });
  },
);
