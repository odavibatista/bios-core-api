import type { INestApplication } from '@nestjs/common';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { OdsListResponseSchema } from '@modules/scoring/domain/dtos/requests/ods-catalog.dto.js';
import { ErrorResponseSchema } from '@shared/domain/dtos/errors/error-response.dto.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import request from 'supertest';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { saveOdsScore } from '../support/ods-score.js';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';
import { testRedisUrl } from '../support/infrastructure.js';

const REDIS_URL = testRedisUrl();

/**
 * Catálogo de ODS e validação do `ods` na pesquisa e na exportação (#332, RF10, RF13, RF14),
 * ponta a ponta no MongoDB real: o que o seletor do front lista é o que a pesquisa aceita.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Catálogo de ODS e ODS aceitos na pesquisa (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let accessToken: string;

    const get = (path: string, query: Record<string, string | number> = {}) =>
      request(app.getHttpServer())
        .get(path)
        .query(query)
        .set('Authorization', `Bearer ${accessToken}`);

    async function setActive(odsNumber: number, isActive: boolean) {
      await prisma.ods.update({
        where: { ods_number: odsNumber },
        data: { is_active: isActive },
      });
    }

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      await prisma.seed(CATALOG_SEEDERS);
      const account = await createTestAccount(app);
      const { body } = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);
      accessToken = body.access_token as string;
    });

    beforeEach(async () => {
      // Começa limpo, sem depender de quem rodou antes no mesmo worker: outro arquivo pode
      // ter deixado o perfil ou o índice desta empresa (o índice é único por CNPJ e ODS).
      await prisma.reset(['company_profile', 'company_ods_scores']);
      await resetThrottleCounters(REDIS_URL);
      await setActive(13, true);
      await setActive(15, true);
      await prisma.companyProfile.create({
        data: {
          cnpj: '11222333000181',
          legal_name: 'ACME AMBIENTAL LTDA',
          registration_status: 'ATIVA',
          company_size: 'DEMAIS',
          address: { city: 'SÃO PAULO', uf: 'SP' },
          main_cnae: { code: '6201501', description: 'DESENVOLVIMENTO' },
          secondary_cnaes: [],
          cadastral_source_id: (
            await prisma.dataSource.findUniqueOrThrow({
              where: { slug: 'BRASIL_API' },
            })
          ).id_data_source,
          content_hash: 'hash',
          refreshed_at: new Date(),
        },
      });
      await saveOdsScore(prisma, '11222333000181', 15, {
        score: -45,
        confidence: 0.5,
      });
    });

    afterEach(async () => {
      await prisma.reset(['company_profile', 'company_ods_scores']);
    });

    afterAll(async () => {
      await setActive(13, true);
      await setActive(15, true);
      await prisma.reset(['users', 'user_sessions', 'login_attempts']);
      await app.close();
    });

    describe('GET /ods', () => {
      it('401 sem sessão', async () => {
        await request(app.getHttpServer()).get('/ods').expect(401);
      });

      it('lista o 13 e o 15 da base semeada, em ordem, com título e descrição', async () => {
        const { body } = await get('/ods').expect(200);
        const parsed = OdsListResponseSchema.parse(body);

        expect(parsed.data.map(({ ods_number }) => ods_number)).toEqual([
          13, 15,
        ]);
        expect(parsed.data[1]).toEqual({
          ods_number: 15,
          title: 'Vida Terrestre',
          description: expect.stringContaining('ecossistemas terrestres'),
        });
        expect(JSON.stringify(body)).not.toContain('id_ods');
      });

      it('não lista o ODS desativado, e volta a listá-lo ao reativar', async () => {
        await setActive(13, false);

        const hidden = await get('/ods').expect(200);

        expect(
          OdsListResponseSchema.parse(hidden.body).data.map(
            ({ ods_number }) => ods_number,
          ),
        ).toEqual([15]);

        await setActive(13, true);

        const shown = await get('/ods').expect(200);

        expect(
          OdsListResponseSchema.parse(shown.body).data.map(
            ({ ods_number }) => ods_number,
          ),
        ).toEqual([13, 15]);
      });
    });

    describe('ODS que o BIOS não calcula na pesquisa', () => {
      it.each([
        ['só o ODS', { ods: 7 }],
        ['com índice mínimo', { ods: 7, min_score: 50 }],
        ['com ordenação', { ods: 7, order: 'desc' }],
        ['junto de outro critério', { ods: 7, uf: 'SP' }],
      ])('422 com a lista dos válidos: %s', async (_label, query) => {
        const { body } = await get('/companies', query).expect(422);

        expect(ErrorResponseSchema.parse(body)).toMatchObject({
          statusCode: 422,
          code: 'ODS_NOT_AVAILABLE',
          details: { ods: 7, valid_ods: [13, 15] },
          path: expect.stringContaining('/companies?'),
        });
      });

      it('o ODS ativo segue funcionando e devolve o índice', async () => {
        const { body } = await get('/companies', { ods: 15 }).expect(200);

        expect(body.data).toHaveLength(1);
        expect(body.data[0].ods_score).toMatchObject({
          ods_number: 15,
          score_value: -45,
        });
      });

      it('ODS ativo sem índice na empresa continua sendo 200 (ausência de cálculo da empresa, não do ODS)', async () => {
        const { body } = await get('/companies', { ods: 13 }).expect(200);

        expect(body.data).toHaveLength(1);
        expect(body.data[0].ods_score).toMatchObject({
          ods_number: 13,
          score_value: null,
        });
      });

      it('desativar o ODS passa a recusá-lo, com os ativos restantes na lista', async () => {
        await setActive(15, false);

        const { body } = await get('/companies', { ods: 15 }).expect(422);

        expect(body).toMatchObject({
          code: 'ODS_NOT_AVAILABLE',
          details: { ods: 15, valid_ods: [13] },
        });
      });

      it('sem o parâmetro `ods`, a pesquisa não consulta nem exige o catálogo', async () => {
        await setActive(13, false);
        await setActive(15, false);

        const { body } = await get('/companies', { uf: 'SP' }).expect(200);

        expect(body.data).toHaveLength(1);
      });
    });

    describe('ODS que o BIOS não calcula na exportação', () => {
      it('422 em JSON, e não uma planilha', async () => {
        const response = await get('/companies/export/xlsx', {
          ods: 7,
          min_score: 10,
        }).expect(422);

        expect(response.headers['content-type']).toContain('application/json');
        expect(ErrorResponseSchema.parse(response.body)).toMatchObject({
          code: 'ODS_NOT_AVAILABLE',
          details: { ods: 7, valid_ods: [13, 15] },
        });
      });

      it('o ODS ativo exporta normalmente', async () => {
        const response = await get('/companies/export/xlsx', { ods: 15 })
          .buffer(true)
          .expect(200);

        expect(response.headers['content-type']).toContain(
          'spreadsheetml.sheet',
        );
      });
    });
  },
);
