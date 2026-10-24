import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { SearchCompaniesResponseSchema } from '@modules/companies/domain/dtos/requests/search-companies.dto.js';
import { EXPORT_MAX_COMPANIES } from '@modules/companies/infra/usecases/export-companies.usecase.js';
import { ErrorResponseSchema } from '@shared/domain/dtos/errors/error-response.dto.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import request, { type Response } from 'supertest';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';
import { readXlsx } from '../support/xlsx-reader.js';

const REDIS_URL = inject('testRedisUrl');
const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Guarda o corpo da resposta como bytes, sem tentar interpretá-lo como texto. */
function binary(
  response: Response,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];

  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

/**
 * Exportação da lista de empresas em XLSX ponta a ponta (UC09, RF15): HTTP, guard, a mesma
 * pesquisa do UC08 no MongoDB real, a leitura dos índices de todos os ODS e o arquivo gerado.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Exportação da lista de empresas em XLSX (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let sourceId: string;
    let accessToken: string;
    let sequence = 0;

    async function saveCompany(
      legalName: string,
      {
        uf = 'SP',
        cnae = '6201501',
        tradeName,
        street,
      }: {
        uf?: string;
        cnae?: string;
        tradeName?: string;
        street?: string;
      } = {},
    ): Promise<string> {
      sequence += 1;
      const cnpj = String(sequence).padStart(14, '0');

      await prisma.companyProfile.create({
        data: {
          cnpj,
          legal_name: legalName,
          ...(tradeName === undefined ? {} : { trade_name: tradeName }),
          registration_status: 'ATIVA',
          company_size: 'DEMAIS',
          address: { city: 'SÃO PAULO', uf, ...(street ? { street } : {}) },
          main_cnae: { code: cnae, description: 'DESENVOLVIMENTO' },
          secondary_cnaes: [],
          cadastral_source_id: sourceId,
          content_hash: 'hash-que-nao-pode-sair',
          refreshed_at: new Date(),
        },
      });

      return cnpj;
    }

    async function saveScore(
      cnpj: string,
      odsNumber: number,
      { score, confidence }: { score: number | null; confidence: number },
    ): Promise<void> {
      const ods = await prisma.ods.findUniqueOrThrow({
        where: { ods_number: odsNumber },
      });

      await prisma.companyOdsScore.create({
        data: {
          cnpj,
          ods_id: ods.id_ods,
          ods_number: odsNumber,
          score_value: score,
          confidence_value: confidence,
          evidence_count: 0,
          contributions: [],
          sources_without_records: [],
          rules_version: 'rf10-rf11-v3',
          cnae_codes: [],
          calculated_at: new Date(),
        },
      });
    }

    function exportXlsx(
      query: Record<string, string | number>,
      token: string | undefined = accessToken,
    ) {
      const call = request(app.getHttpServer())
        .get('/companies/export/xlsx')
        .query(query)
        .buffer(true)
        .parse(binary);

      return token ? call.set('Authorization', `Bearer ${token}`) : call;
    }

    async function exported(query: Record<string, string | number>) {
      const response = await exportXlsx(query).expect(200);

      return readXlsx(new Uint8Array(response.body as Buffer));
    }

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      await prisma.seed(CATALOG_SEEDERS);
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
      accessToken = body.access_token as string;
    });

    beforeEach(async () => {
      sequence = 0;
      await resetThrottleCounters(REDIS_URL);
    });

    afterEach(async () => {
      await prisma.reset(['company_profile', 'company_ods_scores']);
    });

    afterAll(async () => {
      await prisma.reset(['users', 'user_sessions', 'login_attempts']);
      await app.close();
    });

    describe('autenticação e validação', () => {
      it('401 sem sessão', async () => {
        await exportXlsx({ uf: 'SP' }, '').expect(401);
      });

      it.each([
        ['sem nenhum critério', {}],
        ['só a paginação', { page: 2 }],
        ['UF inexistente', { uf: 'XX' }],
        ['CNAE inválido', { cnae: '6' }],
        ['ODS fora da agenda', { ods: 18 }],
        ['índice mínimo sem ODS', { uf: 'SP', min_score: 10 }],
        ['ordenação sem ODS', { uf: 'SP', order: 'asc' }],
        ['nome só de palavras curtas', { name: 'a b do' }],
      ])('422: %s', async (_caso, query) => {
        const response = await exportXlsx(query).expect(422);

        expect(
          ErrorResponseSchema.parse(JSON.parse(String(response.body))).code,
        ).toBe('VALIDATION_FAILED');
      });
    });

    describe('sem resultados', () => {
      it('404 NO_RESULTS_TO_EXPORT, em vez de uma planilha vazia', async () => {
        await saveCompany('ALFA', { uf: 'SP' });

        const response = await exportXlsx({ uf: 'AM' }).expect(404);

        expect(
          ErrorResponseSchema.parse(JSON.parse(String(response.body))).code,
        ).toBe('NO_RESULTS_TO_EXPORT');
      });
    });

    describe('o arquivo', () => {
      it('é um XLSX entregue como anexo, com o tamanho declarado', async () => {
        await saveCompany('ALFA');

        const response = await exportXlsx({ uf: 'SP' }).expect(200);
        const body = response.body as Buffer;

        expect(response.headers['content-type']).toContain(XLSX_TYPE);
        expect(response.headers['content-disposition']).toMatch(
          /^attachment; filename="empresas-bios-\d{4}-\d{2}-\d{2}\.xlsx"$/,
        );
        expect(Number(response.headers['content-length'])).toBe(body.length);
        expect(body.subarray(0, 2).toString('latin1')).toBe('PK');
      });

      it('traz os dados cadastrais e, por ODS, o índice e a confiança em colunas separadas', async () => {
        const alfa = await saveCompany('ALFA', { tradeName: 'ALFA TINTAS' });
        await saveScore(alfa, 13, { score: 60, confidence: 0.2 });
        await saveScore(alfa, 15, { score: -45, confidence: 0.8 });

        const { rows, sheetName } = await exported({ uf: 'SP' });

        expect(sheetName).toBe('Empresas');
        expect(rows[0]).toEqual([
          'CNPJ',
          'Razão social',
          'Nome fantasia',
          'Situação cadastral',
          'UF',
          'Município',
          'CNAE principal',
          'Descrição do CNAE',
          'ODS 13 - Índice',
          'ODS 13 - Confiança',
          'ODS 15 - Índice',
          'ODS 15 - Confiança',
        ]);
        expect(rows[1]).toEqual([
          alfa,
          'ALFA',
          'ALFA TINTAS',
          'ATIVA',
          'SP',
          'SÃO PAULO',
          '6201501',
          'DESENVOLVIMENTO',
          60,
          0.2,
          -45,
          0.8,
        ]);
      });

      it('traz os índices de todos os ODS, e não só do selecionado na pesquisa', async () => {
        const alfa = await saveCompany('ALFA');
        await saveScore(alfa, 13, { score: 60, confidence: 0.2 });
        await saveScore(alfa, 15, { score: -45, confidence: 0.8 });

        const { rows } = await exported({ ods: 15 });

        expect(rows[1].slice(8)).toEqual([60, 0.2, -45, 0.8]);
      });

      it('o que não foi calculado fica vazio, e o índice zero continua zero', async () => {
        const alfa = await saveCompany('ALFA');
        const beta = await saveCompany('BETA');
        await saveScore(alfa, 13, { score: 0, confidence: 0.5 });
        await saveScore(beta, 15, { score: null, confidence: 0 });

        const { rows } = await exported({ uf: 'SP', name: '' });

        expect(rows[1].slice(8)).toEqual([0, 0.5, null, null]);
        expect(rows[2].slice(8)).toEqual([null, null, null, 0]);
      });

      it('o nome fantasia ausente deixa a célula vazia', async () => {
        await saveCompany('ALFA');

        const { rows } = await exported({ uf: 'SP' });

        expect(rows[1][2]).toBeNull();
      });
    });

    describe('mesma lista da pesquisa', () => {
      async function searchNames(query: Record<string, string | number>) {
        const { body } = await request(app.getHttpServer())
          .get('/companies')
          .query({ ...query, page_size: 100 })
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        return SearchCompaniesResponseSchema.parse(body).data.map(
          (company) => company.legal_name,
        );
      }

      beforeEach(async () => {
        const rows: [string, string, string, number | null][] = [
          ['CASA', 'SP', '6201501', -45],
          ['DUNA', 'SP', '6201501', 20],
          ['ECO', 'SP', '1011201', 60],
          ['FAROL', 'RJ', '6201502', 5],
          ['GLEBA', 'SP', '6201501', null],
        ];

        for (const [name, uf, cnae, score] of rows) {
          const cnpj = await saveCompany(name, { uf, cnae });

          await saveScore(cnpj, 15, { score, confidence: 0.5 });
        }
      });

      it.each([
        ['por UF', { uf: 'SP' }],
        ['por CNAE', { cnae: '62' }],
        ['por UF e CNAE', { uf: 'SP', cnae: '62' }],
        ['por nome', { name: 'duna' }],
        ['pelo mínimo de índice', { ods: 15, min_score: 0 }],
        ['ordenada pelo índice, crescente', { ods: 15, order: 'asc' }],
        ['ordenada pelo índice, decrescente', { ods: 15, order: 'desc' }],
        [
          'filtrada e ordenada',
          { uf: 'SP', ods: 15, min_score: -100, order: 'desc' },
        ],
      ])(
        'a planilha tem as empresas e a ordem da pesquisa %s',
        async (_caso, query) => {
          const { rows } = await exported(query);

          expect(rows.slice(1).map((row) => row[1])).toEqual(
            await searchNames(query),
          );
        },
      );

      it('a ordenação por índice vale na planilha: sem índice ao fim, nos dois sentidos', async () => {
        const asc = (await exported({ ods: 15, order: 'asc' })).rows;
        const desc = (await exported({ ods: 15, order: 'desc' })).rows;

        expect(asc.slice(1).map((row) => row[1])).toEqual([
          'CASA',
          'FAROL',
          'DUNA',
          'ECO',
          'GLEBA',
        ]);
        expect(desc.slice(1).map((row) => row[1])).toEqual([
          'ECO',
          'DUNA',
          'FAROL',
          'CASA',
          'GLEBA',
        ]);
      });
    });

    describe('lista inteira, sem paginação', () => {
      it('traz todas as empresas, ainda que a pesquisa pagine em 20, e ignora page e page_size', async () => {
        for (let i = 0; i < 25; i += 1) {
          await saveCompany(`EMPRESA ${String(i).padStart(2, '0')}`);
        }

        const all = await exported({ uf: 'SP' });
        const paged = await exported({ uf: 'SP', page: 2, page_size: 5 });

        expect(all.rows).toHaveLength(26);
        expect(paged.rows).toHaveLength(26);
      });

      it('422 EXPORT_TOO_LARGE acima do limite, dizendo quantas empresas são', async () => {
        const base = await saveCompany('MODELO');
        const template = await prisma.companyProfile.findFirstOrThrow({
          where: { cnpj: base },
        });

        await prisma.companyProfile.createMany({
          data: Array.from({ length: EXPORT_MAX_COMPANIES }, (_, i) => ({
            cnpj: `9${String(i).padStart(13, '0')}`,
            legal_name: `EM MASSA ${i}`,
            registration_status: 'ATIVA',
            address: { city: 'SANTOS', uf: 'SP' },
            main_cnae: { code: '6201501', description: 'DESENVOLVIMENTO' },
            secondary_cnaes: [],
            cadastral_source_id: template.cadastral_source_id,
            content_hash: 'hash',
            refreshed_at: new Date(),
          })),
        });

        const response = await exportXlsx({ uf: 'SP' }).expect(422);
        const error = ErrorResponseSchema.parse(
          JSON.parse(String(response.body)),
        );

        expect(error.code).toBe('EXPORT_TOO_LARGE');
        expect(error.details).toEqual({
          total: EXPORT_MAX_COMPANIES + 1,
          max: EXPORT_MAX_COMPANIES,
        });
      }, 60_000);
    });

    describe('dados pessoais (INL02) e conteúdo interno', () => {
      it('leva o nome já mascarado do empresário individual, e nada do que é interno', async () => {
        await saveCompany('JOAO DA SILVA ***', { street: 'RUA DO SEGREDO' });

        const { rows, allText } = await exported({ uf: 'SP' });

        expect(rows[1][1]).toBe('JOAO DA SILVA ***');
        expect(allText).not.toContain('RUA DO SEGREDO');
        expect(allText).not.toContain('hash-que-nao-pode-sair');
        expect(allText).not.toContain('cadastral_source');
        expect(allText).not.toContain('refreshed_at');
        expect(allText).not.toContain('rf10-rf11');
      });

      it('texto com cara de fórmula sai como texto', async () => {
        await saveCompany('=HYPERLINK("http://x.example","clique")');

        const { rows, hasFormulas } = await exported({ uf: 'SP' });

        expect(rows[1][1]).toBe('=HYPERLINK("http://x.example","clique")');
        expect(hasFormulas).toBe(false);
      });
    });

    describe('limite e documentação', () => {
      it('429 depois de 10 exportações por minuto', async () => {
        for (let i = 0; i < 10; i += 1) {
          await exportXlsx({ uf: 'AM' }).expect(404);
        }

        await exportXlsx({ uf: 'AM' }).expect(429);
      });

      it('a rota e os critérios aparecem no OpenAPI, com o tipo do arquivo', () => {
        const document = SwaggerModule.createDocument(
          app,
          new DocumentBuilder().addBearerAuth().build(),
        );
        const operation = document.paths['/companies/export/xlsx']?.get;
        const parameters = (operation?.parameters ?? []) as {
          name: string;
          in: string;
        }[];

        for (const name of [
          'name',
          'uf',
          'city',
          'cnae',
          'ods',
          'min_score',
          'min_confidence',
          'order',
        ]) {
          expect(parameters).toContainEqual(
            expect.objectContaining({ name, in: 'query' }),
          );
        }
        expect(parameters.map((parameter) => parameter.name)).not.toContain(
          'page',
        );
        expect(JSON.stringify(operation?.responses['200'])).toContain(
          XLSX_TYPE,
        );
      });
    });
  },
);
