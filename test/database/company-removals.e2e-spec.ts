import type { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import request from 'supertest';
import { inject } from 'vitest';
import { resetCache } from '../support/cache.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { testRedisUrl } from '../support/infrastructure.js';
import { createTestAccount } from '../support/test-account.js';
import { withoutEnvironmentalCollection } from '../support/without-environmental-collection.js';

const REDIS_URL = testRedisUrl();

const CNPJ = '11222333000181';

/** Retirada de um cadastro a pedido do titular, ponta a ponta, sobre o MongoDB. */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Cadastros retirados a pedido do titular (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let admin: string;
    let user: string;

    const login = async (email: string, password: string) => {
      const { body } = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      return body.access_token as string;
    };

    const asAdmin = (call: request.Test) =>
      call.set('Authorization', `Bearer ${admin}`);

    const seedCompany = async () => {
      const source = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: 'BRASIL_API' },
      });

      await prisma.companyProfile.create({
        data: {
          cnpj: CNPJ,
          cadastral_source_id: source.id_data_source,
          legal_name: 'TITULAR DE TESTE',
          registration_status: 'ATIVA',
          legal_nature_code: '2135',
          legal_nature: 'Empresário (Individual)',
          address: { city: 'São Paulo', uf: 'SP' },
          main_cnae: { code: '6201501', description: 'Software' },
          secondary_cnaes: [],
          content_hash: 'a'.repeat(64),
          refreshed_at: new Date(),
        },
      });
      await prisma.companyMovement.create({
        data: { cnpj: CNPJ, moved_at: new Date(), ods_movements: [] },
      });
    };

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp(
        withoutEnvironmentalCollection,
      ));
      await prisma.seed(CATALOG_SEEDERS);

      const adminAccount = await createTestAccount(app, {
        role: UserRole.ADMIN,
      });
      const userAccount = await createTestAccount(app);

      admin = await login(adminAccount.email, adminAccount.password);
      user = await login(userAccount.email, userAccount.password);
    });

    beforeEach(async () => {
      await resetCache(REDIS_URL);
      await prisma.reset([
        'company_profile',
        'company_movements',
        'company_removals',
      ]);
      await seedCompany();
    });

    afterAll(async () => {
      await prisma.reset([
        'users',
        'user_sessions',
        'login_attempts',
        'company_profile',
        'company_movements',
        'company_removals',
      ]);
      await app.close();
    });

    it('apaga os dados e o perfil passa a responder 404', async () => {
      const { body } = await asAdmin(
        request(app.getHttpServer())
          .post('/admin/company-removals')
          .send({ cnpj: CNPJ }),
      ).expect(201);

      expect(body).toMatchObject({ cnpj: CNPJ });
      await expect(
        prisma.companyProfile.count({ where: { cnpj: CNPJ } }),
      ).resolves.toBe(0);
      await expect(
        prisma.companyMovement.count({ where: { cnpj: CNPJ } }),
      ).resolves.toBe(0);

      await asAdmin(
        request(app.getHttpServer()).get(`/companies/${CNPJ}`),
      ).expect(404);
    });

    it('a pesquisa não encontra mais o cadastro', async () => {
      await asAdmin(
        request(app.getHttpServer())
          .post('/admin/company-removals')
          .send({ cnpj: CNPJ }),
      ).expect(201);

      const { body } = await asAdmin(
        request(app.getHttpServer())
          .get('/companies')
          .query({ name: 'titular' }),
      ).expect(200);

      expect(body.data).toEqual([]);
    });

    it('lista a retirada, e devolver à lista permite coletar de novo', async () => {
      await asAdmin(
        request(app.getHttpServer())
          .post('/admin/company-removals')
          .send({ cnpj: CNPJ }),
      ).expect(201);

      const { body } = await asAdmin(
        request(app.getHttpServer()).get('/admin/company-removals'),
      ).expect(200);
      expect(body.data).toEqual([
        { cnpj: CNPJ, removed_at: expect.any(String) },
      ]);

      await asAdmin(
        request(app.getHttpServer()).delete(`/admin/company-removals/${CNPJ}`),
      ).expect(204);
      await asAdmin(
        request(app.getHttpServer()).delete(`/admin/company-removals/${CNPJ}`),
      ).expect(404);
    });

    it('é exclusiva de administrador', async () => {
      await request(app.getHttpServer())
        .post('/admin/company-removals')
        .send({ cnpj: CNPJ })
        .expect(401);
      await request(app.getHttpServer())
        .post('/admin/company-removals')
        .set('Authorization', `Bearer ${user}`)
        .send({ cnpj: CNPJ })
        .expect(403);
    });

    it('422: CNPJ inválido', async () => {
      await asAdmin(
        request(app.getHttpServer())
          .post('/admin/company-removals')
          .send({ cnpj: 'invalido' }),
      ).expect(422);
    });
  },
);
