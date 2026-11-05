import type { INestApplication } from '@nestjs/common';
import type { EvidenceCategory } from '@prisma/client';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { CompanyMovementsResponseSchema } from '@modules/companies/domain/dtos/requests/company-movements.dto.js';
import { ListRecentCompanyMovementsUseCase } from '@modules/companies/infra/usecases/list-recent-company-movements.usecase.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import request from 'supertest';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { testRedisUrl } from '../support/infrastructure.js';
import { saveOdsScore } from '../support/ods-score.js';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';

const REDIS_URL = testRedisUrl();
const collections = [
  'company_movements',
  'company_profile',
  'company_ods_scores',
];

/** NFDE03: o requisito fala em base de ao menos 100 mil empresas. */
const COMPANIES = 100_000;
const BATCH = 10_000;
const MAX_MS = 2_000;

/** UC18 ponta a ponta (RF34): HTTP, guard, leitura pelo índice e contrato da resposta. */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Lista de empresas com movimentação recente (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let sourceId: string;
    let odsId: string;
    let accessToken: string;
    let sequence = 0;

    const list = (query: Record<string, string | number> = {}) =>
      request(app.getHttpServer())
        .get('/companies/movements')
        .query(query)
        .set('Authorization', `Bearer ${accessToken}`);

    const profile = (cnpj: string, legalName: string, tradeName?: string) => ({
      cnpj,
      legal_name: legalName,
      ...(tradeName === undefined ? {} : { trade_name: tradeName }),
      registration_status: 'ATIVA',
      company_size: 'DEMAIS',
      address: { city: 'SÃO PAULO', uf: 'SP' },
      main_cnae: { code: '6201501', description: 'DESENVOLVIMENTO' },
      secondary_cnaes: [],
      cadastral_source_id: sourceId,
      content_hash: 'hash',
      refreshed_at: new Date('2026-11-01T00:00:00.000Z'),
    });

    const odsMovement = (
      movedAt: Date,
      odsNumber = 15,
      category: EvidenceCategory = 'INFRACAO_AMBIENTAL',
    ) => ({
      ods_id: odsId,
      ods_number: odsNumber,
      direction: 'DECREASED' as const,
      cause: 'EVIDENCE_ADDED' as const,
      evidence_category: category,
      moved_at: movedAt,
    });

    async function saveCompany(
      legalName: string,
      movedAt: Date,
      options: {
        cnpj?: string;
        tradeName?: string;
        category?: EvidenceCategory;
      } = {},
    ): Promise<string> {
      sequence += 1;
      const cnpj = options.cnpj ?? String(sequence).padStart(14, '0');

      await prisma.companyProfile.create({
        data: profile(cnpj, legalName, options.tradeName),
      });
      await prisma.companyMovement.create({
        data: {
          cnpj,
          moved_at: movedAt,
          ods_movements: [odsMovement(movedAt, 15, options.category)],
        },
      });

      return cnpj;
    }

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
      sequence = 0;
      await prisma.reset(collections);
      await resetThrottleCounters(REDIS_URL);
    });

    afterAll(async () => {
      await prisma.reset(collections);
      await prisma.reset(['users', 'user_sessions', 'login_attempts']);
      await app.close();
    });

    it('sem sessão responde 401, e chave de API não entra', async () => {
      await request(app.getHttpServer())
        .get('/companies/movements')
        .expect(401);
      await request(app.getHttpServer())
        .get('/companies/movements')
        .set('X-API-Key', 'bios_abcd1234_segredo')
        .expect(401);
    });

    it('não colide com a consulta por CNPJ', async () => {
      const { body } = await list().expect(200);

      expect(body).toEqual({
        data: [],
        pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 },
      });
    });

    it('lista da mais recente para a mais antiga, com o CNPJ como desempate', async () => {
      const older = new Date('2026-10-01T00:00:00.000Z');
      const newer = new Date('2026-11-01T00:00:00.000Z');
      const first = await saveCompany('Antiga', older);
      const second = await saveCompany('Nova B', newer, {
        cnpj: '00000000000200',
      });
      const third = await saveCompany('Nova A', newer, {
        cnpj: '00000000000100',
      });

      const { body } = await list().expect(200);

      expect(
        (body as { data: { cnpj: string }[] }).data.map(({ cnpj }) => cnpj),
      ).toEqual([third, second, first]);
    });

    it('monta o contrato: identificação, índice atual e movimentação por ODS', async () => {
      const movedAt = new Date('2026-11-01T12:00:00.000Z');
      const cnpj = await saveCompany('Empresa', movedAt, {
        tradeName: 'Fantasia',
      });

      await saveOdsScore(prisma, cnpj, 15, { score: -40, confidence: 0.33 });

      const { body } = await list().expect(200);

      expect(() => CompanyMovementsResponseSchema.parse(body)).not.toThrow();
      expect(body).toEqual({
        data: [
          {
            cnpj,
            legal_name: 'Empresa',
            trade_name: 'Fantasia',
            city: 'SÃO PAULO',
            uf: 'SP',
            moved_at: movedAt.toISOString(),
            ods: [
              {
                ods_number: 13,
                score_value: null,
                confidence_value: null,
                movement: null,
              },
              {
                ods_number: 15,
                score_value: -40,
                confidence_value: 0.33,
                movement: {
                  direction: 'DECREASED',
                  cause: 'EVIDENCE_ADDED',
                  evidence_category: 'INFRACAO_AMBIENTAL',
                  moved_at: movedAt.toISOString(),
                },
              },
            ],
          },
        ],
        pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
      });
    });

    it('nome fantasia ausente e índice nulo vêm como nulos, nunca zero (IND02)', async () => {
      const cnpj = await saveCompany('Sem fantasia', new Date());

      await saveOdsScore(prisma, cnpj, 15, { score: null, confidence: 0 });

      const { body } = await list().expect(200);
      const [item] = (body as { data: Record<string, unknown>[] }).data;

      expect(item.trade_name).toBeNull();
      expect(item.ods).toContainEqual(
        expect.objectContaining({ ods_number: 15, score_value: null }),
      );
    });

    it('pagina sem repetir nem perder empresas', async () => {
      const moments = [1, 2, 3, 4, 5].map(
        (day) => new Date(`2026-10-0${day}T00:00:00.000Z`),
      );
      const cnpjs = [];

      for (const moment of moments) {
        cnpjs.push(await saveCompany('Empresa', moment));
      }

      const pages = await Promise.all(
        [1, 2, 3].map((page) => list({ page, page_size: 2 }).expect(200)),
      );

      expect(
        pages.flatMap(({ body }) =>
          (body as { data: { cnpj: string }[] }).data.map(({ cnpj }) => cnpj),
        ),
      ).toEqual([...cnpjs].reverse());
      expect(pages[0].body).toMatchObject({
        pagination: { total: 5, total_pages: 3 },
      });
    });

    it('filtra pela categoria, ordena por data e pagina só os itens filtrados', async () => {
      const first = await saveCompany(
        'Emissão antiga',
        new Date('2026-10-01'),
        {
          category: 'EMISSAO_GEE',
        },
      );
      await saveCompany('Infração', new Date('2026-10-03'));
      const last = await saveCompany('Emissão nova', new Date('2026-10-02'), {
        category: 'EMISSAO_GEE',
      });

      const page1 = await list({
        category: 'EMISSAO_GEE',
        page_size: 1,
      }).expect(200);
      const page2 = await list({
        category: 'EMISSAO_GEE',
        page_size: 1,
        page: 2,
      }).expect(200);
      expect(page1.body.data.map(({ cnpj }: { cnpj: string }) => cnpj)).toEqual(
        [last],
      );
      expect(page2.body.data.map(({ cnpj }: { cnpj: string }) => cnpj)).toEqual(
        [first],
      );
      expect(page1.body.pagination).toMatchObject({ total: 2, total_pages: 2 });
      expect(
        (await list({ category: 'CONDUTA_ADMINISTRATIVA' }).expect(200)).body
          .data,
      ).toEqual([]);
      expect((await list().expect(200)).body.pagination.total).toBe(3);
    });

    it('recusa página fora do padrão das listas', async () => {
      await list({ page_size: 101 }).expect(422);
      await list({ page: 0 }).expect(422);
      await list({ category: 'OUTRA_CATEGORIA' }).expect(422);
    });

    it('não consulta fonte externa nem expõe índice anterior', async () => {
      const cnpj = await saveCompany('Empresa', new Date());

      await saveOdsScore(prisma, cnpj, 15, { score: -40, confidence: 0.33 });

      const { text } = await list().expect(200);

      expect(text).not.toMatch(/previous|delta|variation|contributions/);
    });

    it(`responde em até ${MAX_MS} ms sobre ${COMPANIES} empresas (NFDE03)`, async () => {
      const base = Date.parse('2026-11-01T00:00:00.000Z');
      const cnpjOf = (index: number) => String(index).padStart(14, '0');

      for (let start = 0; start < COMPANIES; start += BATCH) {
        const indexes = Array.from({ length: BATCH }, (_, i) => start + i + 1);

        await prisma.companyProfile.createMany({
          data: indexes.map((index) =>
            profile(cnpjOf(index), `Empresa ${index}`),
          ),
        });
        await prisma.companyMovement.createMany({
          data: indexes.map((index) => {
            const movedAt = new Date(base - index * 1000);

            return {
              cnpj: cnpjOf(index),
              moved_at: movedAt,
              ods_movements: [
                odsMovement(
                  movedAt,
                  15,
                  index > COMPANIES - 5 ? 'EMISSAO_GEE' : 'INFRACAO_AMBIENTAL',
                ),
              ],
            };
          }),
        });
      }

      const useCase = app.get(ListRecentCompanyMovementsUseCase, {
        strict: false,
      });
      const timed = async (page: number, category?: EvidenceCategory) => {
        const started = performance.now();
        const { data } = await useCase.execute({
          page,
          page_size: 100,
          category,
        });

        return { ms: performance.now() - started, data };
      };
      const first = await timed(1);
      const deep = await timed(COMPANIES / 100);
      const rare = await timed(1, 'EMISSAO_GEE');

      expect(first.data[0].cnpj).toBe(cnpjOf(1));
      expect(first.data).toHaveLength(100);
      expect(deep.data[99].cnpj).toBe(cnpjOf(COMPANIES));
      expect(rare.data.map(({ cnpj }) => cnpj)).toEqual(
        Array.from({ length: 5 }, (_, index) => cnpjOf(COMPANIES - 4 + index)),
      );
      expect(first.ms).toBeLessThan(MAX_MS);
      expect(deep.ms).toBeLessThan(MAX_MS);
      expect(rare.ms).toBeLessThan(MAX_MS);
      console.info(
        `Movimentações em 100 mil empresas: início ${first.ms.toFixed(1)} ms, página profunda ${deep.ms.toFixed(1)} ms, categoria rara ${rare.ms.toFixed(1)} ms`,
      );
    }, 120_000);
  },
);
