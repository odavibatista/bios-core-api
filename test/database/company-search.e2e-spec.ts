import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { SearchCompaniesResponseSchema } from '@modules/companies/domain/dtos/requests/search-companies.dto.js';
import { ErrorResponseSchema } from '@shared/domain/dtos/errors/error-response.dto.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { Queue } from 'bullmq';
import request from 'supertest';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { type OdsScoreValues, saveOdsScore } from '../support/ods-score.js';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';

const REDIS_URL = inject('testRedisUrl');

/**
 * Pesquisa de empresas ponta a ponta (UC06, fluxo 1.1; UC08; RF04, RF13): HTTP, guard e
 * o pipeline de agregação no MongoDB real, que é onde as expressões regulares de início
 * de palavra, os filtros, a junção com o índice por ODS e a ordenação rodam.
 * Os perfis são gravados como o consumidor da fila os grava.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Pesquisa de empresas (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let sourceId: string;
    let accessToken: string;
    let sequence = 0;

    /** Grava um perfil como o consumidor da fila grava: campo ausente fica ausente. */
    async function saveCompany(
      legalName: string,
      {
        tradeName,
        city = 'SÃO PAULO',
        uf = 'SP',
        cnae = '6201501',
        secondaryCnaes = [],
      }: {
        tradeName?: string;
        city?: string;
        uf?: string;
        cnae?: string;
        secondaryCnaes?: string[];
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
          address: { city, uf },
          main_cnae: { code: cnae, description: 'DESENVOLVIMENTO' },
          secondary_cnaes: secondaryCnaes.map((code) => ({
            code,
            description: 'SECUNDARIA',
          })),
          cadastral_source_id: sourceId,
          content_hash: 'hash',
          refreshed_at: new Date(),
        },
      });

      return cnpj;
    }

    /** Grava o índice de uma empresa em um ODS, como o recálculo (UC15) o grava. */
    const saveScore = (
      cnpj: string,
      odsNumber: number,
      values: OdsScoreValues,
    ): Promise<void> => saveOdsScore(prisma, cnpj, odsNumber, values);

    function search(
      query: Record<string, string | number>,
      token: string | undefined = accessToken,
    ) {
      const call = request(app.getHttpServer()).get('/companies').query(query);

      return token ? call.set('Authorization', `Bearer ${token}`) : call;
    }

    async function names(query: Record<string, string | number>) {
      const { body } = await search(query).expect(200);

      return SearchCompaniesResponseSchema.parse(body).data.map(
        (company) => company.legal_name,
      );
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
        await search({ name: 'petrobras' }, '').expect(401);
      });

      it.each([
        ['sem nenhum critério', {}],
        ['só a paginação', { page: 2 }],
        ['nome vazio', { name: '' }],
        ['nome só de espaços', { name: '   ' }],
        ['só palavras curtas', { name: 'a b do' }],
        ['só pontuação', { name: '***' }],
        ['nome com mais de 100 caracteres', { name: 'a'.repeat(101) }],
        ['página zero', { name: 'petrobras', page: 0 }],
        ['página não numérica', { name: 'petrobras', page: 'x' }],
        ['página grande demais', { name: 'petrobras', page_size: 101 }],
        ['UF inexistente', { uf: 'XX' }],
        ['UF com nome por extenso', { uf: 'São Paulo' }],
        ['município sem letras', { city: '***' }],
        ['CNAE curto demais', { cnae: '6' }],
        ['CNAE com letras', { cnae: '62ab' }],
        ['CNAE longo demais', { cnae: '62015011' }],
        ['ODS zero', { ods: 0 }],
        ['ODS acima de 17', { ods: 18 }],
        ['ODS não numérico', { ods: 'clima' }],
        ['índice mínimo sem ODS', { uf: 'SP', min_score: 10 }],
        ['confiança mínima sem ODS', { uf: 'SP', min_confidence: 0.5 }],
        ['índice mínimo acima de 100', { ods: 15, min_score: 101 }],
        ['índice mínimo não numérico', { ods: 15, min_score: 'alto' }],
        ['confiança mínima acima de 1', { ods: 15, min_confidence: 1.5 }],
        ['confiança mínima negativa', { ods: 15, min_confidence: -0.1 }],
        ['ordenação sem ODS', { uf: 'SP', order: 'asc' }],
        ['ordenação desconhecida', { ods: 15, order: 'up' }],
      ])('422: %s', async (_caso, query) => {
        const response = await search(query).expect(422);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'VALIDATION_FAILED',
        );
      });
    });

    describe('o que casa', () => {
      beforeEach(async () => {
        await saveCompany('PETROLEO BRASILEIRO S A PETROBRAS');
        await saveCompany('INDÚSTRIA E COMÉRCIO ACME LTDA', {
          tradeName: 'ACME TINTAS',
        });
        await saveCompany('URBANA LIMPEZA E SERVICOS LTDA');
        await saveCompany('LIMPEZA PREDIAL LTDA');
      });

      it('pela palavra inteira, sem diferenciar caixa', async () => {
        expect(await names({ name: 'PeTrObRaS' })).toEqual([
          'PETROLEO BRASILEIRO S A PETROBRAS',
        ]);
      });

      it('pela palavra digitada só em parte (início de palavra)', async () => {
        expect(await names({ name: 'petro' })).toEqual([
          'PETROLEO BRASILEIRO S A PETROBRAS',
        ]);
        expect(await names({ name: 'brasil' })).toEqual([
          'PETROLEO BRASILEIRO S A PETROBRAS',
        ]);
      });

      it('o meio da palavra não casa', async () => {
        expect(await names({ name: 'leo' })).toEqual([]);
        expect(await names({ name: 'asileiro' })).toEqual([]);
      });

      it('todas as palavras são exigidas, em qualquer ordem', async () => {
        expect(await names({ name: 'limpeza urbana' })).toEqual([
          'URBANA LIMPEZA E SERVICOS LTDA',
        ]);
        expect(await names({ name: 'limpeza' })).toHaveLength(2);
      });

      it('ignora acentos: digitado sem acento acha o cadastro com acento, e vice-versa', async () => {
        expect(await names({ name: 'industria comercio' })).toEqual([
          'INDÚSTRIA E COMÉRCIO ACME LTDA',
        ]);
        expect(await names({ name: 'Indústria' })).toEqual([
          'INDÚSTRIA E COMÉRCIO ACME LTDA',
        ]);
      });

      it('procura também no nome fantasia', async () => {
        expect(await names({ name: 'tintas' })).toEqual([
          'INDÚSTRIA E COMÉRCIO ACME LTDA',
        ]);
      });

      it('a pontuação digitada não atrapalha', async () => {
        expect(await names({ name: 'S.A. petrobras' })).toEqual([
          'PETROLEO BRASILEIRO S A PETROBRAS',
        ]);
      });

      it('caracteres de expressão regular digitados não funcionam como tal', async () => {
        expect(await names({ name: '.*' + 'petro' })).toEqual([
          'PETROLEO BRASILEIRO S A PETROBRAS',
        ]);
        expect(await names({ name: '(petro|acme)' })).toEqual([]);
      });

      it('nada encontrado: 200 com a lista vazia, e não 404', async () => {
        const { body } = await search({ name: 'inexistente' }).expect(200);

        expect(SearchCompaniesResponseSchema.parse(body)).toEqual({
          data: [],
          pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 },
        });
      });
    });

    describe('resultado', () => {
      it('traz o resumo da empresa, com o nome fantasia ausente como null', async () => {
        const cnpj = await saveCompany('ACME LTDA', {
          city: 'CAMPINAS',
          uf: 'SP',
        });

        const { body } = await search({ name: 'acme' }).expect(200);

        expect(SearchCompaniesResponseSchema.parse(body).data).toEqual([
          {
            cnpj,
            legal_name: 'ACME LTDA',
            trade_name: null,
            registration_status: 'ATIVA',
            city: 'CAMPINAS',
            uf: 'SP',
            main_cnae: { code: '6201501', description: 'DESENVOLVIMENTO' },
            ods_score: null,
          },
        ]);
      });

      it('não expõe hash, fonte, identificador interno nem o restante do endereço', async () => {
        await saveCompany('ACME LTDA');

        const { body } = await search({ name: 'acme' }).expect(200);
        const serialized = JSON.stringify(body);

        expect(serialized).not.toContain('content_hash');
        expect(serialized).not.toContain('cadastral_source');
        expect(serialized).not.toContain('_id');
        expect(serialized).not.toContain('search_rank');
        expect(serialized).not.toContain('refreshed_at');
      });
    });

    describe('ordem', () => {
      it('quem começa pela frase digitada vem antes, mesmo que perca no alfabeto', async () => {
        await saveCompany('ARMAZEM DISTRIBUIDORA TIGRE');
        await saveCompany('TIGRE S.A.');
        await saveCompany('CASA TIGRE COMERCIO');

        expect(await names({ name: 'tigre' })).toEqual([
          'TIGRE S.A.',
          'ARMAZEM DISTRIBUIDORA TIGRE',
          'CASA TIGRE COMERCIO',
        ]);
      });

      it('o nome fantasia também conta para começar pela frase', async () => {
        await saveCompany('ZEBRA LTDA', { tradeName: 'AMBEV LOJA' });
        await saveCompany('ARMAZEM DISTRIBUIDORA AMBEV');

        expect(await names({ name: 'ambev' })).toEqual([
          'ZEBRA LTDA',
          'ARMAZEM DISTRIBUIDORA AMBEV',
        ]);
      });

      it('no mesmo grupo, desempata pela razão social', async () => {
        await saveCompany('AMBEV NORTE');
        await saveCompany('AMBEV CENTRO');
        await saveCompany('AMBEV SUL');

        expect(await names({ name: 'ambev' })).toEqual([
          'AMBEV CENTRO',
          'AMBEV NORTE',
          'AMBEV SUL',
        ]);
      });
    });

    describe('paginação', () => {
      beforeEach(async () => {
        for (const letter of ['A', 'B', 'C', 'D', 'E']) {
          await saveCompany(`NATURA ${letter}`);
        }
      });

      it('divide em páginas, com o total, sem repetir nem pular empresas', async () => {
        const pages: string[][] = [];

        for (const page of [1, 2, 3]) {
          const { body } = await search({
            name: 'natura',
            page,
            page_size: 2,
          }).expect(200);
          const parsed = SearchCompaniesResponseSchema.parse(body);

          expect(parsed.pagination).toEqual({
            page,
            page_size: 2,
            total: 5,
            total_pages: 3,
          });
          pages.push(parsed.data.map((company) => company.legal_name));
        }

        expect(pages).toEqual([
          ['NATURA A', 'NATURA B'],
          ['NATURA C', 'NATURA D'],
          ['NATURA E'],
        ]);
      });

      it('página além do fim: lista vazia, mas o total continua certo', async () => {
        const { body } = await search({
          name: 'natura',
          page: 9,
          page_size: 2,
        }).expect(200);

        expect(SearchCompaniesResponseSchema.parse(body)).toEqual({
          data: [],
          pagination: { page: 9, page_size: 2, total: 5, total_pages: 3 },
        });
      });
    });

    describe('filtros cadastrais (UC08, RF13)', () => {
      beforeEach(async () => {
        await saveCompany('ALFA SP CAPITAL', {
          city: 'SÃO PAULO',
          uf: 'SP',
          cnae: '6201501',
          secondaryCnaes: ['4711301'],
        });
        await saveCompany('BETA SP INTERIOR', {
          city: 'CAMPINAS',
          uf: 'SP',
          cnae: '1011201',
        });
        await saveCompany('GAMA RJ', {
          city: 'RIO DE JANEIRO',
          uf: 'RJ',
          cnae: '6201502',
        });
        await saveCompany('DELTA RN', {
          city: 'SAO PAULO DO POTENGI',
          uf: 'RN',
          cnae: '0111301',
        });
      });

      it('por UF, em qualquer caixa', async () => {
        expect(await names({ uf: 'SP' })).toEqual([
          'ALFA SP CAPITAL',
          'BETA SP INTERIOR',
        ]);
        expect(await names({ uf: 'rj' })).toEqual(['GAMA RJ']);
        expect(await names({ uf: 'AM' })).toEqual([]);
      });

      it('por município, com o nome inteiro e sem distinguir acento nem caixa', async () => {
        expect(await names({ city: 'sao paulo' })).toEqual(['ALFA SP CAPITAL']);
        expect(await names({ city: 'São Paulo' })).toEqual(['ALFA SP CAPITAL']);
        expect(await names({ city: 'rio de janeiro' })).toEqual(['GAMA RJ']);
      });

      it('município não casa por início de palavra nem por pedaço do nome', async () => {
        expect(await names({ city: 'paulo' })).toEqual([]);
        expect(await names({ city: 'sao' })).toEqual([]);
        expect(await names({ city: 'sao paulo do potengi' })).toEqual([
          'DELTA RN',
        ]);
      });

      it('o município de outro estado fica de fora quando a UF é informada', async () => {
        expect(await names({ city: 'sao paulo', uf: 'RN' })).toEqual([]);
        expect(await names({ city: 'sao paulo', uf: 'SP' })).toEqual([
          'ALFA SP CAPITAL',
        ]);
      });

      it('por CNAE: divisão, grupo, classe e subclasse', async () => {
        expect(await names({ cnae: '62' })).toEqual([
          'ALFA SP CAPITAL',
          'GAMA RJ',
        ]);
        expect(await names({ cnae: '620' })).toEqual([
          'ALFA SP CAPITAL',
          'GAMA RJ',
        ]);
        expect(await names({ cnae: '62015' })).toEqual([
          'ALFA SP CAPITAL',
          'GAMA RJ',
        ]);
        expect(await names({ cnae: '6201501' })).toEqual(['ALFA SP CAPITAL']);
        expect(await names({ cnae: '10' })).toEqual(['BETA SP INTERIOR']);
      });

      it('o CNAE casa também o secundário, e aceita a máscara', async () => {
        expect(await names({ cnae: '4711301' })).toEqual(['ALFA SP CAPITAL']);
        expect(await names({ cnae: '47' })).toEqual(['ALFA SP CAPITAL']);
        expect(await names({ cnae: '6201-5/01' })).toEqual(['ALFA SP CAPITAL']);
      });

      it('o código do CNAE é prefixo, não trecho do meio', async () => {
        expect(await names({ cnae: '11' })).toEqual([]);
        expect(await names({ cnae: '201' })).toEqual([]);
      });

      it('os critérios se somam', async () => {
        expect(await names({ uf: 'SP', cnae: '62' })).toEqual([
          'ALFA SP CAPITAL',
        ]);
        expect(await names({ uf: 'RJ', cnae: '62', name: 'gama' })).toEqual([
          'GAMA RJ',
        ]);
        expect(await names({ uf: 'SP', cnae: '01' })).toEqual([]);
        expect(await names({ uf: 'SP', name: 'gama' })).toEqual([]);
      });

      it('sem nome, a lista vem por razão social; a paginação segue estável', async () => {
        const pages: string[][] = [];

        for (const page of [1, 2]) {
          const { body } = await search({
            uf: 'SP',
            page,
            page_size: 1,
          }).expect(200);
          const parsed = SearchCompaniesResponseSchema.parse(body);

          expect(parsed.pagination).toMatchObject({ total: 2, total_pages: 2 });
          pages.push(parsed.data.map((company) => company.legal_name));
        }

        expect(pages).toEqual([['ALFA SP CAPITAL'], ['BETA SP INTERIOR']]);
      });

      it('sem ODS selecionado, o item vem com ods_score nulo', async () => {
        const { body } = await search({ uf: 'RJ' }).expect(200);

        expect(
          SearchCompaniesResponseSchema.parse(body).data[0].ods_score,
        ).toBeNull();
      });

      it('critério em branco vale como não informado', async () => {
        expect(await names({ uf: 'RJ', city: '', cnae: '', ods: '' })).toEqual([
          'GAMA RJ',
        ]);
      });
    });

    describe('ODS selecionado: índice e confiança mínimos (UC08, RF13)', () => {
      let alfa: string;
      let beta: string;
      let gama: string;
      let delta: string;

      beforeEach(async () => {
        alfa = await saveCompany('ALFA', { uf: 'SP' });
        beta = await saveCompany('BETA', { uf: 'SP' });
        gama = await saveCompany('GAMA', { uf: 'SP' });
        delta = await saveCompany('DELTA', { uf: 'RJ' });
        // ODS 15: ALFA negativo e confiável, BETA positivo e pouco confiável, GAMA sem
        // índice conclusivo (nota nula, confiança zero); DELTA nunca foi calculada.
        await saveScore(alfa, 15, { score: -45, confidence: 0.8 });
        await saveScore(beta, 15, { score: 20, confidence: 0.3 });
        await saveScore(gama, 15, { score: null, confidence: 0 });
        // ODS 13: só ALFA, com valores diferentes dos do ODS 15.
        await saveScore(alfa, 13, { score: 60, confidence: 0.2 });
      });

      async function items(query: Record<string, string | number>) {
        const { body } = await search(query).expect(200);

        return SearchCompaniesResponseSchema.parse(body).data.map(
          (company) => ({
            name: company.legal_name,
            ods_score: company.ods_score,
          }),
        );
      }

      it('seleciona o ODS e traz o índice e a confiança dele em cada empresa, nulos sem cálculo', async () => {
        expect(await items({ ods: 15 })).toEqual([
          {
            name: 'ALFA',
            ods_score: {
              ods_number: 15,
              score_value: -45,
              confidence_value: 0.8,
            },
          },
          {
            name: 'BETA',
            ods_score: {
              ods_number: 15,
              score_value: 20,
              confidence_value: 0.3,
            },
          },
          {
            name: 'DELTA',
            ods_score: {
              ods_number: 15,
              score_value: null,
              confidence_value: null,
            },
          },
          {
            name: 'GAMA',
            ods_score: {
              ods_number: 15,
              score_value: null,
              confidence_value: 0,
            },
          },
        ]);
      });

      it('cada ODS traz os seus próprios valores, sem misturá-los', async () => {
        const climate = await items({ ods: 13, uf: 'SP' });

        expect(climate).toEqual([
          {
            name: 'ALFA',
            ods_score: {
              ods_number: 13,
              score_value: 60,
              confidence_value: 0.2,
            },
          },
          {
            name: 'BETA',
            ods_score: {
              ods_number: 13,
              score_value: null,
              confidence_value: null,
            },
          },
          {
            name: 'GAMA',
            ods_score: {
              ods_number: 13,
              score_value: null,
              confidence_value: null,
            },
          },
        ]);
      });

      it('índice mínimo: só quem tem índice igual ou acima; sem índice não passa', async () => {
        expect(await names({ ods: 15, min_score: 0 })).toEqual(['BETA']);
        expect(await names({ ods: 15, min_score: -45 })).toEqual([
          'ALFA',
          'BETA',
        ]);
        expect(await names({ ods: 15, min_score: -100 })).toEqual([
          'ALFA',
          'BETA',
        ]);
        expect(await names({ ods: 15, min_score: 21 })).toEqual([]);
      });

      it('índice mínimo zero filtra (não equivale a sem filtro)', async () => {
        expect(await names({ ods: 15, min_score: 0 })).not.toContain('ALFA');
      });

      it('confiança mínima: só quem tem confiança igual ou acima', async () => {
        expect(await names({ ods: 15, min_confidence: 0.5 })).toEqual(['ALFA']);
        expect(await names({ ods: 15, min_confidence: 0.3 })).toEqual([
          'ALFA',
          'BETA',
        ]);
      });

      it('confiança mínima zero deixa passar quem tem confiança zero, mas não quem nunca foi calculado', async () => {
        expect(await names({ ods: 15, min_confidence: 0 })).toEqual([
          'ALFA',
          'BETA',
          'GAMA',
        ]);
      });

      it('os dois mínimos se somam', async () => {
        expect(
          await names({ ods: 15, min_score: -50, min_confidence: 0.5 }),
        ).toEqual(['ALFA']);
        expect(
          await names({ ods: 15, min_score: 0, min_confidence: 0.5 }),
        ).toEqual([]);
      });

      it('os mínimos valem para o ODS selecionado, e não para o outro', async () => {
        // ALFA tem índice 60 no ODS 13 e -45 no 15.
        expect(await names({ ods: 13, min_score: 50 })).toEqual(['ALFA']);
        expect(await names({ ods: 15, min_score: 50 })).toEqual([]);
      });

      it('somam-se aos filtros cadastrais', async () => {
        expect(
          await names({ ods: 15, min_score: -100, uf: 'SP', name: 'beta' }),
        ).toEqual(['BETA']);
        expect(await names({ ods: 15, uf: 'RJ' })).toEqual(['DELTA']);
        expect(await names({ ods: 15, min_score: -100, uf: 'RJ' })).toEqual([]);
      });

      it('conta o total depois dos mínimos', async () => {
        const { body } = await search({
          ods: 15,
          min_score: -100,
          page: 1,
          page_size: 1,
        }).expect(200);
        const parsed = SearchCompaniesResponseSchema.parse(body);

        expect(parsed.data).toHaveLength(1);
        expect(parsed.pagination).toMatchObject({ total: 2, total_pages: 2 });
      });

      it('empresa de fora da base cadastral não aparece, ainda que tenha índice', async () => {
        await saveScore('99999999999999', 15, { score: 90, confidence: 1 });

        expect(await names({ ods: 15, min_score: 80 })).toEqual([]);
        expect(await names({ ods: 15 })).toHaveLength(4);
      });

      it('não expõe contribuições, datas nem identificadores do índice', async () => {
        const { body } = await search({ ods: 15 }).expect(200);
        const serialized = JSON.stringify(body);

        expect(serialized).not.toContain('contributions');
        expect(serialized).not.toContain('calculated_at');
        expect(serialized).not.toContain('rules_version');
        expect(serialized).not.toContain('ods_id');
        expect(serialized).not.toContain('_id');
        expect(serialized).not.toContain(delta + 'x');
      });
    });

    describe('ordenação pelo índice do ODS (RF14)', () => {
      beforeEach(async () => {
        // ODS 15: índices -45, -10, 20, 20 (empate) e 60; dois sem índice conclusivo
        // (nota nula) e um nunca calculado.
        const rows: [string, number | null, number | null][] = [
          ['CASA', -45, 0.8],
          ['DUNA', -10, 0.5],
          ['ECO', 20, 0.3],
          ['FAROL', 20, 0.9],
          ['GLEBA', 60, 0.4],
          ['HORTO', null, 0.7],
          ['IPE', null, 0],
        ];

        for (const [name, score, confidence] of rows) {
          const cnpj = await saveCompany(name, { uf: 'SP' });

          await saveScore(cnpj, 15, { score, confidence: confidence ?? 0 });
        }

        await saveCompany('JACA', { uf: 'SP' }); // sem documento de índice
        await saveCompany('LIRIO', { uf: 'RJ' });
      });

      it('crescente: do menor ao maior índice, com os sem índice ao fim', async () => {
        expect(await names({ uf: 'SP', ods: 15, order: 'asc' })).toEqual([
          'CASA',
          'DUNA',
          'FAROL',
          'ECO',
          'GLEBA',
          'HORTO',
          'IPE',
          'JACA',
        ]);
      });

      it('decrescente: do maior ao menor índice, e os sem índice continuam ao fim', async () => {
        expect(await names({ uf: 'SP', ods: 15, order: 'desc' })).toEqual([
          'GLEBA',
          'FAROL',
          'ECO',
          'DUNA',
          'CASA',
          'HORTO',
          'IPE',
          'JACA',
        ]);
      });

      it('empate de índice: a maior confiança vem primeiro, nos dois sentidos', async () => {
        const asc = await names({ uf: 'SP', ods: 15, order: 'asc' });
        const desc = await names({ uf: 'SP', ods: 15, order: 'desc' });

        expect(asc.indexOf('FAROL')).toBeLessThan(asc.indexOf('ECO'));
        expect(desc.indexOf('FAROL')).toBeLessThan(desc.indexOf('ECO'));
      });

      it('entre os sem índice, a maior confiança vem primeiro e depois a razão social', async () => {
        const asc = await names({ uf: 'SP', ods: 15, order: 'asc' });

        expect(asc.slice(-3)).toEqual(['HORTO', 'IPE', 'JACA']);
      });

      it('o índice zero é um índice: não vai para o fim junto dos sem índice', async () => {
        const cnpj = await saveCompany('MARE', { uf: 'SP' });

        await saveScore(cnpj, 15, { score: 0, confidence: 0.1 });

        const asc = await names({ uf: 'SP', ods: 15, order: 'asc' });

        expect(asc.indexOf('MARE')).toBeLessThan(asc.indexOf('HORTO'));
        expect(asc.indexOf('MARE')).toBeGreaterThan(asc.indexOf('DUNA'));
        expect(asc.indexOf('MARE')).toBeLessThan(asc.indexOf('ECO'));
      });

      it('a ordem vale para o ODS selecionado, e não para o outro', async () => {
        const cnpj = (
          await prisma.companyProfile.findFirstOrThrow({
            where: { legal_name: 'GLEBA' },
          })
        ).cnpj;

        await saveScore(cnpj, 13, { score: -90, confidence: 0.5 });

        const climate = await names({ uf: 'SP', ods: 13, order: 'asc' });
        const land = await names({ uf: 'SP', ods: 15, order: 'asc' });

        expect(climate[0]).toBe('GLEBA');
        expect(land[0]).toBe('CASA');
      });

      it('os mínimos e a ordem se combinam, e o total conta só quem passou', async () => {
        const { body } = await search({
          uf: 'SP',
          ods: 15,
          min_score: 0,
          order: 'desc',
        }).expect(200);
        const parsed = SearchCompaniesResponseSchema.parse(body);

        expect(parsed.data.map((company) => company.legal_name)).toEqual([
          'GLEBA',
          'FAROL',
          'ECO',
        ]);
        expect(parsed.pagination.total).toBe(3);
      });

      it('a ordenação vale mais que a prioridade da frase digitada', async () => {
        await saveCompany('GLEBA NORTE', { uf: 'SP' });
        const sul = await saveCompany('SUL GLEBA', { uf: 'SP' });

        await saveScore(sul, 15, { score: -80, confidence: 0.2 });

        expect(await names({ name: 'gleba', ods: 15, order: 'asc' })).toEqual([
          'SUL GLEBA',
          'GLEBA',
          'GLEBA NORTE',
        ]);
      });

      it('a paginação segue a ordem, sem repetir nem pular empresas', async () => {
        const pages: string[][] = [];

        for (const page of [1, 2, 3, 4]) {
          const { body } = await search({
            uf: 'SP',
            ods: 15,
            order: 'desc',
            page,
            page_size: 2,
          }).expect(200);
          const parsed = SearchCompaniesResponseSchema.parse(body);

          expect(parsed.pagination).toMatchObject({ total: 8, total_pages: 4 });
          pages.push(parsed.data.map((company) => company.legal_name));
        }

        expect(pages.flat()).toEqual(
          await names({ uf: 'SP', ods: 15, order: 'desc', page_size: 100 }),
        );
        expect(new Set(pages.flat()).size).toBe(8);
      });

      it('aceita a ordem em maiúsculas', async () => {
        expect((await names({ uf: 'SP', ods: 15, order: 'DESC' }))[0]).toBe(
          'GLEBA',
        );
      });

      it('sem ordem pedida, a lista continua por razão social', async () => {
        expect((await names({ uf: 'SP', ods: 15 })).slice(0, 3)).toEqual([
          'CASA',
          'DUNA',
          'ECO',
        ]);
      });

      it('não expõe o campo auxiliar da ordenação', async () => {
        const { body } = await search({
          uf: 'SP',
          ods: 15,
          order: 'asc',
        }).expect(200);

        expect(JSON.stringify(body)).not.toContain('score_missing');
      });
    });

    describe('documentação OpenAPI (RF13)', () => {
      it('declara os filtros como parâmetros de consulta', () => {
        const document = SwaggerModule.createDocument(
          app,
          new DocumentBuilder().addBearerAuth().build(),
        );
        const parameters = (document.paths['/companies']?.get?.parameters ??
          []) as { name: string; in: string }[];

        for (const name of [
          'name',
          'uf',
          'city',
          'cnae',
          'ods',
          'min_score',
          'min_confidence',
          'order',
          'page',
          'page_size',
        ]) {
          expect(parameters).toContainEqual(
            expect.objectContaining({ name, in: 'query' }),
          );
        }
      });
    });

    describe('dados pessoais (INL02)', () => {
      it('acha o empresário individual pelo nome, que guarda o CPF mascarado', async () => {
        await saveCompany('JOAO DA SILVA ***');

        expect(await names({ name: 'joao silva' })).toEqual([
          'JOAO DA SILVA ***',
        ]);
      });

      it('digitar um CPF não encontra o titular', async () => {
        await saveCompany('JOAO DA SILVA ***');

        expect(await names({ name: '12345678901' })).toEqual([]);
        expect(await names({ name: '123.456.789-01' })).toEqual([]);
      });
    });

    describe('efeitos', () => {
      it('só lê a base local: não publica job nem consulta provedor', async () => {
        await saveCompany('ACME LTDA');
        const queue = new Queue(QueueName.COMPANY_PROFILE, {
          connection: { url: REDIS_URL },
        });

        try {
          await queue.obliterate({ force: true });
          await search({ name: 'acme' }).expect(200);
          await search({ name: 'inexistente' }).expect(200);

          const counts = await queue.getJobCounts();
          expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(0);
        } finally {
          await queue.close();
        }
      });
    });
  },
);
