import type { INestApplication } from '@nestjs/common';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import {
  SectorEvolutionResponseSchema,
  SectorListResponseSchema,
} from '@modules/scoring/domain/dtos/requests/sector-evolution.dto.js';
import { AGGREGATE_SECTOR_SCORES_JOB } from '@modules/scoring/domain/ods-scoring-job.dto.js';
import { AggregateSectorScoresUseCase } from '@modules/scoring/infra/usecases/aggregate-sector-scores.usecase.js';
import { ErrorResponseSchema } from '@shared/domain/dtos/errors/error-response.dto.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { QueueProvider } from '@shared/domain/providers/queue.provider.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import request from 'supertest';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { faker } from '../support/faker.js';
import { saveOdsScore } from '../support/ods-score.js';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';
import { testRedisUrl } from '../support/infrastructure.js';

const REDIS_URL = testRedisUrl();
const OCTOBER = new Date('2026-10-20T12:00:00Z');
const NOVEMBER = new Date('2026-11-20T12:00:00Z');
const COLLECTIONS = [
  'company_profile',
  'company_ods_scores',
  'sector_score_snapshots',
];

/**
 * Evolução setorial (RF30, UC10, IA05, #89 e #90) no MongoDB, no Redis e na fila reais: o job
 * agrega os índices por ODS e divisão CNAE em janelas mensais, e a rota mostra a série do setor.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Evolução do índice médio por setor (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let aggregate: AggregateSectorScoresUseCase;
    let accessToken: string;
    let sourceId: string;
    let sequence = 0;

    /** Grava um perfil com o CNAE principal informado e o índice dele no ODS. */
    async function company(
      mainCnae: string,
      ods: Record<number, { score: number | null; confidence: number }>,
      { withProfile = true }: { withProfile?: boolean } = {},
    ): Promise<string> {
      sequence += 1;
      const cnpj = String(sequence).padStart(14, '0');

      if (withProfile) {
        await prisma.companyProfile.create({
          data: {
            cnpj,
            legal_name: faker.company.name(),
            registration_status: 'ATIVA',
            address: { city: 'SÃO PAULO', uf: 'SP' },
            main_cnae: { code: mainCnae, description: 'ATIVIDADE' },
            // O secundário de outro setor não muda o setor da empresa.
            secondary_cnaes: [{ code: '0115600', description: 'SOJA' }],
            cadastral_source_id: sourceId,
            content_hash: 'hash',
            refreshed_at: new Date(),
          },
        });
      }
      for (const [odsNumber, values] of Object.entries(ods)) {
        await saveOdsScore(prisma, cnpj, Number(odsNumber), values);
      }

      return cnpj;
    }

    const evolution = (cnae: string, query: Record<string, unknown> = {}) =>
      request(app.getHttpServer())
        .get(`/sectors/${encodeURIComponent(cnae)}/evolution`)
        .query(query)
        .set('Authorization', `Bearer ${accessToken}`);

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      await prisma.seed(CATALOG_SEEDERS);
      aggregate = app.get(AggregateSectorScoresUseCase);
      sourceId = (
        await prisma.dataSource.findUniqueOrThrow({
          where: { slug: 'BRASIL_API' },
        })
      ).id_data_source;
      const account = await createTestAccount(app);
      const { body } = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);
      accessToken = (body as { access_token: string }).access_token;
    });

    beforeEach(async () => {
      sequence = 0;
      await prisma.reset(COLLECTIONS);
      await resetThrottleCounters(REDIS_URL);
    });

    afterAll(async () => {
      await prisma.reset([
        ...COLLECTIONS,
        'users',
        'user_sessions',
        'login_attempts',
      ]);
      await app.close();
    });

    it('agrega por ODS e divisão do CNAE principal e mostra a evolução do setor mês a mês', async () => {
      // Setor 62: cinco empresas com índice (o mínimo padrão) e uma sem índice no ODS 15.
      for (const score of [-10, -25, 0, 10, 15, null]) {
        await company('6201501', { 15: { score, confidence: 0.5 } });
      }
      await aggregate.execute(OCTOBER);

      await prisma.companyOdsScore.updateMany({
        where: { ods_number: 15, score_value: { not: null } },
        data: { score_value: 20 },
      });
      await aggregate.execute(NOVEMBER);

      const { body } = await evolution('62.01-5/01', { ods: 15 }).expect(200);
      const parsed = SectorEvolutionResponseSchema.parse(body);

      expect(parsed).toMatchObject({
        cnae_division: '62',
        cnae_division_description:
          'ATIVIDADES DOS SERVIÇOS DE TECNOLOGIA DA INFORMAÇÃO',
        ods_number: 15,
        history_status: 'AVAILABLE',
      });
      expect(parsed.windows).toEqual([
        {
          window_start: '2026-10-01T00:00:00.000Z',
          window_end: '2026-11-01T00:00:00.000Z',
          // Índice médio das cinco com índice; confiança média das seis.
          average_score: -2,
          average_confidence: 0.5,
          company_count: 6,
          scored_company_count: 5,
          rules_version: 'rf10-rf11-v3',
        },
        expect.objectContaining({
          window_start: '2026-11-01T00:00:00.000Z',
          average_score: 20,
        }),
      ]);
    });

    it('setor com menos empresas que o mínimo: médias omitidas, contagens mantidas (IA05)', async () => {
      for (let index = 0; index < 2; index += 1) {
        await company('0115600', { 15: { score: 30, confidence: 0.9 } });
      }
      await aggregate.execute(OCTOBER);

      const { body } = await evolution('01', { ods: 15 }).expect(200);

      expect(SectorEvolutionResponseSchema.parse(body).windows).toEqual([
        expect.objectContaining({
          average_score: null,
          average_confidence: null,
          company_count: 2,
          scored_company_count: 2,
        }),
      ]);
    });

    it('uma janela só: histórico insuficiente, com o que já há (fluxo 2.1)', async () => {
      await company('6201501', { 15: { score: 5, confidence: 0.5 } });
      await aggregate.execute(OCTOBER);

      const { body } = await evolution('62', { ods: 15 }).expect(200);

      expect(SectorEvolutionResponseSchema.parse(body)).toMatchObject({
        history_status: 'INSUFFICIENT',
        windows: [expect.objectContaining({ company_count: 1 })],
      });
    });

    it('sem agregados do setor: lista vazia e histórico insuficiente', async () => {
      const { body } = await evolution('47', { ods: 13 }).expect(200);

      expect(SectorEvolutionResponseSchema.parse(body)).toEqual({
        cnae_division: '47',
        cnae_division_description: 'COMÉRCIO VAREJISTA',
        ods_number: 13,
        history_status: 'INSUFFICIENT',
        windows: [],
      });
    });

    it('reexecutar no mesmo mês sobrescreve, sem duplicar; o setor que sumiu sai da janela', async () => {
      await company('6201501', { 15: { score: 5, confidence: 0.5 } });
      const leaving = await company('4711302', {
        15: { score: 1, confidence: 0.5 },
      });
      await aggregate.execute(OCTOBER);
      await aggregate.execute(OCTOBER);

      expect(await prisma.sectorScoreSnapshot.count()).toBe(2);

      await prisma.companyOdsScore.deleteMany({ where: { cnpj: leaving } });
      await aggregate.execute(new Date('2026-10-25T00:00:00Z'));

      const kept = await prisma.sectorScoreSnapshot.findMany();
      expect(kept.map(({ cnae_division }) => cnae_division)).toEqual(['62']);
    });

    it('empresa sem perfil (sem setor) e índice de outra versão das regras ficam de fora', async () => {
      await company('6201501', { 15: { score: 10, confidence: 0.5 } });
      await company(
        '6201501',
        { 15: { score: 99, confidence: 0.9 } },
        {
          withProfile: false,
        },
      );
      const stale = await company('6201501', {
        15: { score: -99, confidence: 0.1 },
      });
      await prisma.companyOdsScore.updateMany({
        where: { cnpj: stale },
        data: { rules_version: 'versao-antiga' },
      });

      await aggregate.execute(OCTOBER);

      const [snapshot] = await prisma.sectorScoreSnapshot.findMany();
      expect(snapshot).toMatchObject({
        cnae_division: '62',
        company_count: 1,
        rules_version: 'rf10-rf11-v3',
      });
    });

    it('o job agendado roda pela fila real e grava os agregados', async () => {
      await company('6201501', { 13: { score: 4, confidence: 0.3 } });

      await app.get(QueueProvider).enqueueAndWait(
        QueueName.ODS_SCORING,
        AGGREGATE_SECTOR_SCORES_JOB,
        {},
        {
          timeoutMs: 10_000,
        },
      );

      expect(await prisma.sectorScoreSnapshot.count()).toBe(1);
    });

    it('lista os setores com agregados, uma vez cada, com a descrição oficial', async () => {
      await company('6201501', { 13: { score: 1, confidence: 0.5 } });
      await company('6202300', { 15: { score: 2, confidence: 0.5 } });
      await company('0115600', { 15: { score: 3, confidence: 0.5 } });
      await aggregate.execute(OCTOBER);
      await aggregate.execute(NOVEMBER);

      const { body } = await request(app.getHttpServer())
        .get('/sectors')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(SectorListResponseSchema.parse(body)).toEqual({
        data: [
          {
            cnae_division: '01',
            description: 'AGRICULTURA, PECUÁRIA E SERVIÇOS RELACIONADOS',
          },
          {
            cnae_division: '62',
            description: 'ATIVIDADES DOS SERVIÇOS DE TECNOLOGIA DA INFORMAÇÃO',
          },
        ],
      });
    });

    it('sem agregados, a lista de setores é vazia', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/sectors')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(body).toEqual({ data: [] });
    });

    it('nunca por empresa: nem o banco nem a resposta têm CNPJ, nome ou índice individual', async () => {
      const cnpjs: string[] = [];
      for (const score of [1, 2, 3, 4, 5]) {
        cnpjs.push(
          await company('6201501', { 15: { score, confidence: 0.5 } }),
        );
      }
      await aggregate.execute(OCTOBER);

      const stored = JSON.stringify(
        await prisma.sectorScoreSnapshot.findMany(),
      );
      const { body } = await evolution('62', { ods: 15 }).expect(200);
      const answered = JSON.stringify(body);

      for (const cnpj of cnpjs) {
        expect(stored).not.toContain(cnpj);
        expect(answered).not.toContain(cnpj);
      }
      expect(answered).not.toMatch(/cnpj|legal_name/);
    });

    describe('validação e acesso', () => {
      it('401 sem sessão', async () => {
        await request(app.getHttpServer())
          .get('/sectors/62/evolution')
          .query({ ods: 15 })
          .expect(401);
        await request(app.getHttpServer()).get('/sectors').expect(401);
      });

      it.each(['6', '6201', 'abc', '00', '04', '98'])(
        'CNAE inválido (%j): 422',
        async (cnae) => {
          await evolution(cnae, { ods: 15 }).expect(422);
        },
      );

      it('ODS obrigatório: 422', async () => {
        await evolution('62').expect(422);
      });

      it('ODS que o BIOS não calcula: 422 ODS_NOT_AVAILABLE com os válidos', async () => {
        const { body } = await evolution('62', { ods: 7 }).expect(422);

        expect(ErrorResponseSchema.parse(body)).toMatchObject({
          code: 'ODS_NOT_AVAILABLE',
          details: { valid_ods: [13, 15] },
        });
      });
    });
  },
);
