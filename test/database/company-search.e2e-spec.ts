import type { INestApplication } from '@nestjs/common';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { SearchCompaniesResponseSchema } from '@modules/companies/domain/dtos/requests/search-companies.dto.js';
import { ErrorResponseSchema } from '@shared/domain/dtos/errors/error-response.dto.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { Queue } from 'bullmq';
import request from 'supertest';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';

const REDIS_URL = inject('testRedisUrl');

/**
 * Busca de empresas por razão social ou nome fantasia ponta a ponta (UC06,
 * fluxo 1.1; RF04): HTTP, guard e o pipeline de agregação no MongoDB real, que
 * é onde as expressões regulares de início de palavra e a ordenação rodam.
 * Os perfis são gravados como o consumidor da fila os grava.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Busca de empresa por nome (e2e)',
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
      }: { tradeName?: string; city?: string; uf?: string } = {},
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
          main_cnae: { code: '6201501', description: 'DESENVOLVIMENTO' },
          secondary_cnaes: [],
          cadastral_source_id: sourceId,
          content_hash: 'hash',
          refreshed_at: new Date(),
        },
      });

      return cnpj;
    }

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
      await prisma.reset(['company_profile']);
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
        ['sem o nome', {}],
        ['nome vazio', { name: '' }],
        ['nome só de espaços', { name: '   ' }],
        ['só palavras curtas', { name: 'a b do' }],
        ['só pontuação', { name: '***' }],
        ['nome com mais de 100 caracteres', { name: 'a'.repeat(101) }],
        ['página zero', { name: 'petrobras', page: 0 }],
        ['página não numérica', { name: 'petrobras', page: 'x' }],
        ['página grande demais', { name: 'petrobras', page_size: 101 }],
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
