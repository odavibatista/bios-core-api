import type { INestApplication } from '@nestjs/common';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { ErrorResponseSchema } from '@shared/domain/dtos/errors/error-response.dto.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { Queue, Worker } from 'bullmq';
import request from 'supertest';
import { inject } from 'vitest';
import { CompanyProfileResponseSchema } from '@modules/companies/domain/dtos/requests/company-profile.dto.js';
import { CompanyProfileProcessor } from '@modules/companies/infra/queue/company-profile.processor.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { withoutEnvironmentalCollection } from '../support/without-environmental-collection.js';
import { resetCache } from '../support/cache.js';
import { faker } from '../support/faker.js';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';
import { testRedisUrl } from '../support/infrastructure.js';

const REDIS_URL = testRedisUrl();

/** Registro do que o "serviço de ingestão" simulado recebeu e como responde. */
interface IngestionStub {
  /** Jobs recebidos: nome e payload, exatamente como o core os publicou. */
  received: { name: string; data: unknown }[];

  /** Comportamento do próximo job; padrão: grava o cadastro e devolve `FOUND`. */
  behavior: (cnpj: string) => Promise<unknown>;
}

const SEVEN_DAYS_MS = 7 * 86_400_000;

/**
 * Consulta de empresa por CNPJ ponta a ponta (UC06): HTTP, guard, cache em
 * Redis, MongoDB e a fila BullMQ. O consumidor da fila é simulado por um
 * *worker* real na fila `company-profile`, que grava `company_profile` e devolve
 * o resultado do contrato — o que permite provocar cada resposta e até
 * respostas fora do contrato.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Consulta de empresa por CNPJ (e2e)',
  () => {
    const ingestion: IngestionStub = {
      received: [],
      behavior: (cnpj) => writeProfileAndFind(cnpj),
    };
    let app: INestApplication;
    let prisma: PrismaService;
    let cache: CacheProvider;
    let worker: Worker;
    let sourceId: string;
    let accessToken: string;
    /** Jobs que o serviço simulado deixou pendurados; liberados ao fim de cada teste. */
    const hungJobs: (() => void)[] = [];

    /** Grava (ou atualiza) o cadastro como o serviço de ingestão gravaria. */
    async function writeProfile(
      cnpj: string,
      overrides: { legal_name?: string; refreshed_at?: Date } = {},
    ): Promise<void> {
      const data = {
        legal_name: overrides.legal_name ?? faker.company.name(),
        trade_name: faker.company.name(),
        registration_status: 'ATIVA',
        company_size: 'DEMAIS',
        address: {
          street: 'Avenida Paulista',
          number: '1578',
          neighborhood: 'Bela Vista',
          city: 'São Paulo',
          city_ibge_code: '3550308',
          uf: 'SP',
          zipcode: '01310200',
        },
        main_cnae: {
          code: '6201501',
          description: 'Desenvolvimento de software',
        },
        secondary_cnaes: [
          { code: '6202300', description: 'Consultoria em tecnologia' },
        ],
        content_hash: faker.string.hexadecimal({ length: 64, prefix: '' }),
        refreshed_at: overrides.refreshed_at ?? new Date(),
      };

      await prisma.companyProfile.upsert({
        where: { cnpj },
        create: { cnpj, cadastral_source_id: sourceId, ...data },
        update: data,
      });
    }

    async function writeProfileAndFind(cnpj: string): Promise<unknown> {
      await writeProfile(cnpj);

      return { outcome: 'FOUND' };
    }

    beforeAll(async () => {
      // O consumidor real da fila fica de fora: aqui o consumidor é o *worker*
      // simulado abaixo, que permite provocar cada resposta do contrato. O
      // consumidor real tem a suíte própria `company-profile-ingestion`.
      ({ app, prisma } = await createDatabaseTestingApp((builder) => {
        builder.overrideProvider(CompanyProfileProcessor).useValue({});
        withoutEnvironmentalCollection(builder);
      }));
      cache = app.get(CacheProvider);
      await prisma.seed(CATALOG_SEEDERS);
      sourceId = (
        await prisma.dataSource.findUniqueOrThrow({
          where: { slug: 'BRASIL_API' },
        })
      ).id_data_source;

      worker = new Worker(
        QueueName.COMPANY_PROFILE,
        async (job) => {
          ingestion.received.push({ name: job.name, data: job.data });

          return ingestion.behavior((job.data as { cnpj: string }).cnpj);
        },
        { connection: { url: REDIS_URL, maxRetriesPerRequest: null } },
      );
      await worker.waitUntilReady();

      accessToken = await signIn();
    });

    beforeEach(async () => {
      ingestion.received.length = 0;
      ingestion.behavior = (cnpj) => writeProfileAndFind(cnpj);
      await resetThrottleCounters(REDIS_URL);
      await resetCache(REDIS_URL);
    });

    afterEach(async () => {
      hungJobs.splice(0).forEach((release) => release());
      await prisma.reset(['company_profile']);
      const queue = new Queue(QueueName.COMPANY_PROFILE, {
        connection: { url: REDIS_URL },
      });
      await queue.obliterate({ force: true });
      await queue.close();
    });

    afterAll(async () => {
      await worker.close(true);
      await prisma.reset(['users', 'user_sessions', 'login_attempts']);
      await app.close();
    });

    async function signIn(): Promise<string> {
      const account = await createTestAccount(app);
      const { body } = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);

      return body.access_token as string;
    }

    function getCompany(cnpj: string, token: string | undefined = accessToken) {
      const call = request(app.getHttpServer()).get(`/companies/${cnpj}`);

      return token ? call.set('Authorization', `Bearer ${token}`) : call;
    }

    const CNPJ = '11222333000181';

    describe('autenticação e validação', () => {
      it('401 sem sessão', async () => {
        await getCompany(CNPJ, '').expect(401);

        expect(ingestion.received).toHaveLength(0);
      });

      it.each(['11222333000182', '00000000000000', '123', 'abcdefghijklmn'])(
        '422: CNPJ inválido "%s", sem consultar a fila',
        async (cnpj) => {
          const response = await getCompany(cnpj).expect(422);

          expect(ErrorResponseSchema.parse(response.body).code).toBe(
            'INVALID_CNPJ',
          );
          expect(ingestion.received).toHaveLength(0);
        },
      );
    });

    describe('cadastro ausente: atualização pela fila', () => {
      it('200: publica o job, espera o serviço gravar o cadastro e o devolve', async () => {
        const response = await getCompany(CNPJ).expect(200);

        expect(CompanyProfileResponseSchema.parse(response.body)).toMatchObject(
          {
            cnpj: CNPJ,
            registration_status: 'ATIVA',
            company_size: 'DEMAIS',
            address: { city: 'São Paulo', uf: 'SP', zipcode: '01310200' },
            main_cnae: {
              code: '6201501',
              description: 'Desenvolvimento de software',
            },
            secondary_cnaes: [
              { code: '6202300', description: 'Consultoria em tecnologia' },
            ],
          },
        );
      });

      it('o serviço recebe o job da fila certa, com o nome e o payload do contrato', async () => {
        await getCompany(CNPJ).expect(200);

        expect(ingestion.received).toEqual([
          { name: 'fetch-company-profile', data: { cnpj: CNPJ } },
        ]);
      });

      it('a segunda consulta vem do cache: o serviço não é chamado de novo', async () => {
        const first = await getCompany(CNPJ).expect(200);

        const second = await getCompany(CNPJ).expect(200);

        expect(second.body).toEqual(first.body);
        expect(ingestion.received).toHaveLength(1);
        await expect(
          cache.get({
            namespace: CacheNamespace.COMPANY_PROFILE,
            identifier: CNPJ,
          }),
        ).resolves.toMatchObject({ cnpj: CNPJ });
      });

      it('aceita o CNPJ com máscara e em minúsculas, e trata como o mesmo', async () => {
        await getCompany(CNPJ).expect(200);

        await getCompany('11.222.333%2F0001-81').expect(200);

        expect(ingestion.received).toHaveLength(1);
      });

      it('aceita o CNPJ alfanumérico', async () => {
        const response = await getCompany('12abc34501de35').expect(200);

        expect(response.body.cnpj).toBe('12ABC34501DE35');
        expect(ingestion.received[0].data).toEqual({ cnpj: '12ABC34501DE35' });
      });

      it('pedidos simultâneos do mesmo CNPJ compartilham um único job', async () => {
        ingestion.behavior = async (cnpj) => {
          await new Promise((resolve) => setTimeout(resolve, 300));

          return writeProfileAndFind(cnpj);
        };

        const responses = await Promise.all(
          Array.from({ length: 5 }, () => getCompany(CNPJ)),
        );

        expect(responses.map(({ status }) => status)).toEqual(
          Array(5).fill(200),
        );
        expect(ingestion.received).toHaveLength(1);
      });

      it('não expõe campo interno nem dado de sócios', async () => {
        const response = await getCompany(CNPJ).expect(200);

        const serialized = JSON.stringify(response.body);
        expect(serialized).not.toContain('content_hash');
        expect(serialized).not.toContain('cadastral_source');
        expect(serialized).not.toMatch(/s[óo]cio|partner|qsa|cpf/i);
      });
    });

    describe('cadastro guardado dentro da validade', () => {
      it('serve do banco, sem chamar a fila, e passa a servir do cache', async () => {
        await writeProfile(CNPJ, { legal_name: 'Empresa Guardada S.A.' });

        const first = await getCompany(CNPJ).expect(200);
        const second = await getCompany(CNPJ).expect(200);

        expect(first.body.legal_name).toBe('Empresa Guardada S.A.');
        expect(second.body).toEqual(first.body);
        expect(ingestion.received).toHaveLength(0);
        await expect(
          cache.get({
            namespace: CacheNamespace.COMPANY_PROFILE,
            identifier: CNPJ,
          }),
        ).resolves.toMatchObject({ legal_name: 'Empresa Guardada S.A.' });
      });
    });

    describe('cadastro vencido', () => {
      const staleAt = () => new Date(Date.now() - SEVEN_DAYS_MS - 3_600_000);

      it('atualiza pela fila e serve o cadastro novo', async () => {
        await writeProfile(CNPJ, {
          legal_name: 'Nome Antigo Ltda.',
          refreshed_at: staleAt(),
        });
        ingestion.behavior = async (cnpj) => {
          await writeProfile(cnpj, { legal_name: 'Nome Novo Ltda.' });

          return { outcome: 'FOUND' };
        };

        const response = await getCompany(CNPJ).expect(200);

        expect(response.body.legal_name).toBe('Nome Novo Ltda.');
        expect(ingestion.received).toHaveLength(1);
      });

      it('respeita a janela da fonte ajustada no banco, sem novo deploy', async () => {
        await writeProfile(CNPJ, {
          legal_name: 'Ainda Valido',
          refreshed_at: new Date(Date.now() - 2 * 86_400_000),
        });
        await prisma.dataSource.update({
          where: { slug: 'BRASIL_API' },
          data: { cache_ttl_seconds: 86_400 },
        });

        try {
          await getCompany(CNPJ).expect(200);
        } finally {
          await prisma.dataSource.update({
            where: { slug: 'BRASIL_API' },
            data: { cache_ttl_seconds: 7 * 86_400 },
          });
        }

        // Com a janela de 1 dia, o cadastro de 2 dias já vencera e foi atualizado.
        expect(ingestion.received).toHaveLength(1);
      });

      it('com os provedores indisponíveis, serve o cadastro vencido e não o guarda no cache', async () => {
        await writeProfile(CNPJ, {
          legal_name: 'Vencido Mas Util',
          refreshed_at: staleAt(),
        });
        ingestion.behavior = () =>
          Promise.resolve({ outcome: 'SOURCES_UNAVAILABLE' });

        const first = await getCompany(CNPJ).expect(200);
        const second = await getCompany(CNPJ).expect(200);

        expect(first.body.legal_name).toBe('Vencido Mas Util');
        expect(second.body.legal_name).toBe('Vencido Mas Util');
        await expect(
          cache.get({
            namespace: CacheNamespace.COMPANY_PROFILE,
            identifier: CNPJ,
          }),
        ).resolves.toBeUndefined();
      });

      it('dentro da janela do job, a nova consulta reaproveita o resultado em vez de bater de novo nos provedores', async () => {
        await writeProfile(CNPJ, { refreshed_at: staleAt() });
        ingestion.behavior = () =>
          Promise.resolve({ outcome: 'SOURCES_UNAVAILABLE' });

        await getCompany(CNPJ).expect(200);
        await getCompany(CNPJ).expect(200);
        await getCompany(CNPJ).expect(200);

        // Respeita o limite de requisições das fontes (NFPD01): uma indisponibilidade
        // não vira uma enxurrada de tentativas enquanto os provedores se recuperam.
        expect(ingestion.received).toHaveLength(1);
      });
    });

    describe('empresa inexistente', () => {
      it('404: os provedores confirmam que o CNPJ não existe', async () => {
        ingestion.behavior = () => Promise.resolve({ outcome: 'NOT_FOUND' });

        const response = await getCompany(CNPJ).expect(404);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'COMPANY_NOT_FOUND',
        );
      });

      it('não guarda a inexistência no cache: a próxima consulta pergunta de novo', async () => {
        ingestion.behavior = () => Promise.resolve({ outcome: 'NOT_FOUND' });
        await getCompany(CNPJ).expect(404);
        // Fora da janela de deduplicação do job, para a segunda consulta publicar outro.
        ingestion.behavior = (cnpj) => writeProfileAndFind(cnpj);
        await new Promise((resolve) => setTimeout(resolve, 0));

        await expect(
          cache.get({
            namespace: CacheNamespace.COMPANY_PROFILE,
            identifier: CNPJ,
          }),
        ).resolves.toBeUndefined();
      });
    });

    describe('provedores indisponíveis e sem cadastro guardado', () => {
      it('503: o serviço informa SOURCES_UNAVAILABLE', async () => {
        ingestion.behavior = () =>
          Promise.resolve({ outcome: 'SOURCES_UNAVAILABLE' });

        const response = await getCompany(CNPJ).expect(503);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'COMPANY_DATA_UNAVAILABLE',
        );
      });

      it('503: o resultado do job está fora do contrato', async () => {
        ingestion.behavior = () => Promise.resolve({ qualquer: 'coisa' });

        await getCompany(CNPJ).expect(503);
      });

      it('503: o job falha em todas as tentativas', async () => {
        ingestion.behavior = () =>
          Promise.reject(new Error('todos os provedores falharam'));

        const response = await getCompany(CNPJ).expect(503);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'COMPANY_DATA_UNAVAILABLE',
        );
      });

      it('503: o serviço não responde dentro do prazo', async () => {
        ingestion.behavior = () =>
          new Promise((resolve) => {
            hungJobs.push(() => resolve({ outcome: 'SOURCES_UNAVAILABLE' }));
          });

        const started = Date.now();
        await getCompany(CNPJ).expect(503);

        expect(Date.now() - started).toBeLessThan(6_000);
      });

      it('o 503 não se confunde com o 404 e não deixa nada no cache', async () => {
        ingestion.behavior = () =>
          Promise.resolve({ outcome: 'SOURCES_UNAVAILABLE' });
        await getCompany(CNPJ).expect(503);

        await expect(
          cache.get({
            namespace: CacheNamespace.COMPANY_PROFILE,
            identifier: CNPJ,
          }),
        ).resolves.toBeUndefined();
      });
    });
  },
);
