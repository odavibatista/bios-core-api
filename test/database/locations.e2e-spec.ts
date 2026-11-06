import type { INestApplication } from '@nestjs/common';
import { faker } from '@test/support/faker.js';
import { CityCodeBackfill } from '@modules/locations/infra/db/backfill/city-code-backfill.js';
import { LocationsSeeder } from '@modules/locations/infra/db/seeders/locations.seeder.js';
import type { PrismaService } from '@shared/infra/database/prisma.service.js';
import request from 'supertest';
import { inject } from 'vitest';
import { resetCache } from '../support/cache.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { testRedisUrl } from '../support/infrastructure.js';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';

const REDIS_URL = testRedisUrl();
const PARATY = '3303807';
const SAO_PAULO = '3550308';
const ASSU = '2400208';

/** RF38 ponta a ponta: catálogo, seletor e filtro pelo código, no MongoDB real. */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'UFs e municípios (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let accessToken: string;
    let sourceId: string;

    const get = (path: string, query: Record<string, string | number> = {}) =>
      request(app.getHttpServer())
        .get(path)
        .query(query)
        .set('Authorization', `Bearer ${accessToken}`);

    const saveCompany = async (
      legalName: string,
      city: string,
      uf: string,
      cityIbgeCode: string | null = null,
    ) => {
      const cnpj = faker.string.numeric(14);

      await prisma.companyProfile.create({
        data: {
          cnpj,
          cadastral_source_id: sourceId,
          legal_name: legalName,
          registration_status: 'ATIVA',
          address: { city, uf, city_ibge_code: cityIbgeCode },
          main_cnae: { code: '4711301', description: 'Varejo' },
          secondary_cnaes: [],
          content_hash: 'a'.repeat(64),
          refreshed_at: new Date(),
        },
      });

      return cnpj;
    };

    const namesFor = async (query: Record<string, string>) => {
      const { body } = await get('/companies', query).expect(200);

      return (body as { data: { legal_name: string }[] }).data
        .map(({ legal_name }) => legal_name)
        .sort();
    };

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
    });

    beforeEach(async () => {
      await prisma.reset();
      await resetCache(REDIS_URL);
      await resetThrottleCounters(REDIS_URL);
      await new LocationsSeeder().run(prisma);

      const account = await createTestAccount(app);
      const { body } = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);

      accessToken = (body as { access_token: string }).access_token;
      sourceId = (
        await prisma.dataSource.create({
          data: {
            slug: faker.string.alpha(12),
            name: 'Fonte de teste',
            base_url: 'https://fonte.invalid',
            role: 'CADASTRAL',
            ingestion_mode: 'ON_DEMAND',
          },
        })
      ).id_data_source;
    });

    afterAll(async () => {
      await app.close();
    });

    describe('carga do catálogo', () => {
      it('grava as 27 UFs e os 5.571 municípios, com nome normalizado e sinônimos', async () => {
        expect(await prisma.ibgeState.count()).toBe(27);
        expect(await prisma.ibgeCity.count()).toBe(5_571);
        expect(
          await prisma.ibgeCity.findUniqueOrThrow({
            where: { id_ibge_city: Number(PARATY) },
          }),
        ).toMatchObject({
          name: 'Paraty',
          search_name: 'PARATY',
          aliases: ['PARATI'],
          ibge_state_id: 33,
        });
      });

      it('rodar de novo não duplica e restaura o nome oficial', async () => {
        await prisma.ibgeCity.update({
          where: { id_ibge_city: Number(PARATY) },
          data: { name: 'Nome alterado' },
        });

        await new LocationsSeeder().run(prisma);

        expect(await prisma.ibgeCity.count()).toBe(5_571);
        expect(
          await prisma.ibgeCity.findUniqueOrThrow({
            where: { id_ibge_city: Number(PARATY) },
          }),
        ).toMatchObject({ name: 'Paraty' });
      });
    });

    describe('GET /locations/states', () => {
      it('exige sessão', async () => {
        await request(app.getHttpServer()).get('/locations/states').expect(401);
      });

      it('lista as 27 UFs por nome', async () => {
        const { body } = await get('/locations/states').expect(200);
        const { data } = body as {
          data: { ibge_code: string; acronym: string; name: string }[];
        };

        expect(data).toHaveLength(27);
        expect(data[0]).toEqual({
          ibge_code: '12',
          acronym: 'AC',
          name: 'Acre',
        });
      });
    });

    describe('GET /locations/states/:uf/cities', () => {
      it('lista só os municípios da UF', async () => {
        const { body } = await get('/locations/states/SP/cities', {
          search: 'sao',
          page_size: 100,
        }).expect(200);
        const { data, pagination } = body as {
          data: { ibge_code: string; name: string; uf: string }[];
          pagination: { total: number };
        };

        expect(pagination.total).toBeGreaterThan(20);
        expect(data.every(({ uf }) => uf === 'SP')).toBe(true);
        expect(data[0].name.startsWith('São')).toBe(true);
        expect(data.map(({ ibge_code }) => ibge_code)).toContain(SAO_PAULO);
      });

      it('acha pelo trecho, sem distinguir acento nem caixa', async () => {
        const { body } = await get('/locations/states/pi/cities', {
          search: 'TERE',
        }).expect(200);

        expect((body as { data: { name: string }[] }).data[0].name).toBe(
          'Teresina',
        );
      });

      it('acha pela grafia de outra fonte', async () => {
        const { body } = await get('/locations/states/RJ/cities', {
          search: 'parati',
        }).expect(200);

        expect(
          (body as { data: { name: string }[] }).data.map(({ name }) => name),
        ).toContain('Paraty');
      });

      it('sem busca, devolve a primeira página', async () => {
        const { body } = await get('/locations/states/MG/cities').expect(200);

        expect(body).toMatchObject({
          pagination: { page: 1, page_size: 20, total: 853, total_pages: 43 },
        });
      });

      it('UF inválida responde erro de validação', async () => {
        await get('/locations/states/XX/cities').expect(422);
      });
    });

    describe('filtro por município (RF38)', () => {
      beforeEach(async () => {
        await saveCompany('POUSADA NOVA', 'PARATY', 'RJ');
        await saveCompany('POUSADA ANTIGA', 'PARATI', 'RJ');
        await saveCompany('OUTRA CIDADE', 'NITEROI', 'RJ');
        await saveCompany('MESMO NOME EM OUTRA UF', 'PARATI', 'SP');
      });

      it('o código alcança o nome oficial e a grafia antiga, só na UF', async () => {
        expect(await namesFor({ uf: 'RJ', city_ibge_code: PARATY })).toEqual([
          'POUSADA ANTIGA',
          'POUSADA NOVA',
        ]);
      });

      it('vale também para a grafia oficial que a base escreve diferente', async () => {
        await saveCompany('COMERCIO ASSU', 'ASSU', 'RN');
        await saveCompany('COMERCIO ACU', 'ACU', 'RN');

        expect(await namesFor({ uf: 'RN', city_ibge_code: ASSU })).toEqual([
          'COMERCIO ACU',
          'COMERCIO ASSU',
        ]);
      });

      it('o panorama e a exportação usam o mesmo município', async () => {
        const { body } = await get('/companies/analytics', {
          uf: 'RJ',
          city_ibge_code: PARATY,
        }).expect(200);

        expect((body as { companies: number }).companies).toBe(2);

        await get('/companies/export/xlsx', {
          uf: 'RJ',
          city_ibge_code: PARATY,
        }).expect(200);
      });

      it.each([
        ['código de outra UF', { uf: 'SP', city_ibge_code: PARATY }],
        ['código sem UF', { city_ibge_code: PARATY }],
        ['nome sem UF', { city: 'PARATY' }],
        [
          'nome e código juntos',
          { uf: 'RJ', city: 'X', city_ibge_code: PARATY },
        ],
        ['código mal formado', { uf: 'RJ', city_ibge_code: '123' }],
      ])('recusa %s', async (_case, query) => {
        await get('/companies', query).expect(422);
      });

      it('a recusa de outra UF traz o código do erro', async () => {
        const { body } = await get('/companies', {
          uf: 'SP',
          city_ibge_code: PARATY,
        }).expect(422);

        expect(body).toMatchObject({ code: 'CITY_NOT_IN_STATE' });
      });
    });

    describe('preenchimento do código nos cadastros', () => {
      it('grava o código por local, sem tocar em quem já tem e em quem não está no catálogo', async () => {
        const antiga = await saveCompany('ANTIGA', 'PARATI', 'RJ');
        const nova = await saveCompany('NOVA', 'Paraty', 'RJ');
        const pronta = await saveCompany('PRONTA', 'NITEROI', 'RJ', '9999999');
        const exterior = await saveCompany('FORA', 'EXTERIOR', 'EX');
        const backfill = new CityCodeBackfill();
        const codeOf = async (cnpj: string) =>
          (await prisma.companyProfile.findUniqueOrThrow({ where: { cnpj } }))
            .address.city_ibge_code;

        const gaps = await backfill.plan(prisma);

        expect(gaps).toHaveLength(3);
        expect(gaps.find(({ uf }) => uf === 'EX')?.ibgeCode).toBeNull();
        await expect(backfill.apply(prisma, gaps)).resolves.toBe(2);
        expect(await codeOf(antiga)).toBe(PARATY);
        expect(await codeOf(nova)).toBe(PARATY);
        expect(await codeOf(pronta)).toBe('9999999');
        expect(await codeOf(exterior)).toBeNull();
      });

      it('rodar de novo não muda nada', async () => {
        await saveCompany('ANTIGA', 'PARATI', 'RJ');
        const backfill = new CityCodeBackfill();

        await backfill.apply(prisma, await backfill.plan(prisma));

        expect(await backfill.plan(prisma)).toEqual([]);
      });
    });
  },
);
