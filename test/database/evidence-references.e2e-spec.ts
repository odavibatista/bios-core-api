import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { ResponseObject, SchemaObject } from '@nestjs/swagger';
import { inject } from 'vitest';
import request from 'supertest';
import type { Queue } from 'bullmq';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { companyProfileResponseFactory } from '../factories/companies/company-profile.factory.js';
import { CompanyEnvironmentalEvidencesResponseSchema } from '@modules/evidences/domain/dtos/requests/company-evidences.dto.js';
import { IBAMA_DATASET_URLS } from '@modules/ibama/domain/ibama-evidence.mapper.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import {
  QUEUE_REGISTRY,
  type QueueRegistry,
} from '@shared/infra/providers/bullmq-queue.provider.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { buildCnpj } from '../factories/companies/company-profile.factory.js';
import { otherCguCnpj } from '../factories/cgu/cgu-sanction.factory.js';
import { faker } from '../support/faker.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { createTestAccount } from '../support/test-account.js';
import { resetCache } from '../support/cache.js';
import { resetThrottleCounters } from '../support/throttle.js';

const redisUrl = inject('testRedisUrl');
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'RF09: referências pela rota autenticada com Mongo/Redis reais',
  () => {
    let app: INestApplication,
      prisma: PrismaService,
      record: RecordEvidenceCollectionUseCase,
      queues: Queue[];
    let cnpj: string, token: string;
    const route = (value = cnpj) => `/companies/${value}/evidences`;
    const http = () =>
      request(app.getHttpServer())
        .get(route())
        .set('Authorization', `Bearer ${token}`);
    const rows = (body: unknown) =>
      CompanyEnvironmentalEvidencesResponseSchema.parse(
        body,
      ).categories.flatMap((g) => g.evidences);
    const clean = [
      'evidence_normalized',
      'evidence_raw',
      'company_profile',
      'data_source_request_logs',
      'ingestion_runs',
      'data_sources',
      'users',
      'user_sessions',
      'login_attempts',
    ];
    async function settle() {
      const end = Date.now() + 10000;
      while (
        (
          await Promise.all(
            queues.map(async (q) =>
              Object.values(
                await q.getJobCounts('active', 'waiting', 'delayed'),
              ).some(Boolean),
            ),
          )
        ).some(Boolean)
      ) {
        if (Date.now() > end) throw new Error('jobs não concluíram');
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      record = app.get(RecordEvidenceCollectionUseCase);
      const registry = app.get<QueueRegistry>(QUEUE_REGISTRY);
      queues = [
        registry.get(QueueName.ENVIRONMENTAL_EVIDENCES)!,
        registry.get(QueueName.GHG_INVENTORY)!,
        registry.get(QueueName.IBAMA_INGESTION)!,
      ];
    });
    beforeEach(async () => {
      await settle();
      for (const q of queues) await q.obliterate({ force: true });
      await resetCache(redisUrl);
      await resetThrottleCounters(redisUrl);
      await prisma.reset(clean);
      await prisma.seed(CATALOG_SEEDERS);
      cnpj = buildCnpj();
      const source = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: 'BRASIL_API' },
      });
      const { refreshed_at, ...profile } = companyProfileResponseFactory.build({
        cnpj,
      });
      await prisma.companyProfile.create({
        data: {
          ...profile,
          refreshed_at: new Date(refreshed_at),
          cadastral_source_id: source.id_data_source,
          content_hash: faker.string.hexadecimal({ length: 64, prefix: '' }),
        },
      });
      // Consulta de proveniência usa retratos locais. Nunca baixar fontes oficiais nesta suíte.
      await prisma.dataSource.updateMany({ data: { is_enabled: false } });
      const account = await createTestAccount(app);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);
      token = (login.body as { access_token: string }).access_token;
      const sources = [
        {
          slug: 'IBAMA',
          reference: faker.string.alphanumeric(10),
          url: IBAMA_DATASET_URLS.AUTO_INFRACAO,
        },
        {
          slug: 'CGU_CEIS',
          reference: String(faker.number.int({ min: 1, max: 999999 })),
          url: 'https://api.portaldatransparencia.gov.br/api-de-dados/ceis',
        },
        {
          slug: 'CGU_CNEP',
          reference: String(faker.number.int({ min: 1, max: 999999 })),
          url: 'https://api.portaldatransparencia.gov.br/api-de-dados/cnep',
        },
        {
          slug: 'GHG_PROTOCOL',
          reference: '5091/19',
          url: 'https://sistema-registropublicodeemissoesapi.fgv.br/GenerateReport/GenerateInventoryReport/5091/19/true',
        },
      ];
      for (const source of sources)
        await record.execute({
          cnpj,
          sourceSlug: source.slug,
          result: {
            status: 'COLLECTED',
            findings: [
              {
                reference: source.reference,
                url: source.url,
                summary: faker.lorem.sentence(),
                details: { reference: source.reference },
              },
            ],
          },
        });
    });
    afterAll(async () => {
      await settle();
      for (const q of queues) await q.obliterate({ force: true });
      await prisma.reset(clean);
      await resetCache(redisUrl);
      await resetThrottleCounters(redisUrl);
      await app.close();
    });
    it('401 sem sessão ou apenas com chave de API, sem consultar fontes', async () => {
      await request(app.getHttpServer()).get(route()).expect(401);
      await request(app.getHttpServer())
        .get(route())
        .set('x-api-key', faker.string.alphanumeric(40))
        .expect(401);
      expect(await prisma.dataSourceRequestLog.count()).toBe(0);
    });
    it('422 para CNPJ inválido antes de publicar jobs', async () => {
      await request(app.getHttpServer())
        .get(route('invalido'))
        .set('Authorization', `Bearer ${token}`)
        .expect(422);
      for (const q of queues) expect(await q.getWaitingCount()).toBe(0);
      expect(await prisma.dataSourceRequestLog.count()).toBe(0);
    });
    it('404 para CNPJ válido sem perfil, sem escrita, HTTP externo ou jobs', async () => {
      const other = otherCguCnpj(cnpj);
      const before = await Promise.all(queues.map((q) => q.getJobCounts()));
      const response = await request(app.getHttpServer())
        .get(route(other))
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(response.body).toMatchObject({ code: 'COMPANY_NOT_FOUND' });
      expect(
        await prisma.evidenceNormalized.count({ where: { cnpj: other } }),
      ).toBe(0);
      expect(await prisma.evidenceRaw.count({ where: { cnpj: other } })).toBe(
        0,
      );
      expect(await prisma.dataSourceRequestLog.count()).toBe(0);
      expect(await Promise.all(queues.map((q) => q.getJobCounts()))).toEqual(
        before,
      );
    });
    it('limita a rota a 20 consultas por minuto por IP', async () => {
      for (let index = 0; index < 20; index++) await http().expect(200);
      await http().expect(429);
      expect(await prisma.dataSourceRequestLog.count()).toBe(0);
    });
    it('200 entrega quatro fontes do catálogo, referência, HTTPS e nenhum campo interno', async () => {
      const response = await http().expect(200),
        evidences = rows(response.body);
      expect(evidences).toHaveLength(4);
      for (const e of evidences) {
        const source = await prisma.dataSource.findUniqueOrThrow({
          where: { slug: e.source_slug },
        });
        expect(e.source).toBe(source.name);
        expect(e.state).toBe('CONFIRMED');
        expect(e.source_reference).toBeTruthy();
        expect(e.source_url).toMatch(/^https:\/\//);
        expect(e).not.toHaveProperty('key');
        expect(e).not.toHaveProperty('rawEvidenceId');
        expect(e).not.toHaveProperty('data_source_id');
      }
      expect(evidences.find((e) => e.source_slug === 'IBAMA')!.source_url).toBe(
        IBAMA_DATASET_URLS.AUTO_INFRACAO,
      );
      expect(await prisma.dataSourceRequestLog.count()).toBe(0);
    });
    it('reutiliza o consolidado sem renovar proveniência/datas nem publicar jobs', async () => {
      const first = (await http().expect(200)).body as unknown;
      await resetCache(redisUrl);
      expect((await http().expect(200)).body).toEqual(first);
      expect(await prisma.dataSourceRequestLog.count()).toBe(0);
      for (const q of queues)
        expect(
          await q.getJobCounts('completed', 'waiting', 'active'),
        ).toMatchObject({ completed: 0, waiting: 0, active: 0 });
    });
    it('usa o nome atual do catálogo sem fixar rótulo no código', async () => {
      const name = `IBAMA — ${faker.company.name()}`;
      await prisma.dataSource.update({
        where: { slug: 'IBAMA' },
        data: { name },
      });
      expect(
        rows((await http().expect(200)).body).find(
          (e) => e.source_slug === 'IBAMA',
        )!.source,
      ).toBe(name);
    });
    it('legado CONFIRMED sem caminho de auditoria é UNKNOWN neutro, banco preservado', async () => {
      await prisma.evidenceNormalized.updateMany({
        where: { data_source: { slug: 'CGU_CEIS' } },
        data: { source_reference: null, source_url: null },
      });
      const original = await prisma.evidenceNormalized.findFirstOrThrow({
        where: { cnpj, data_source: { slug: 'CGU_CEIS' } },
      });
      const evidences = rows((await http().expect(200)).body);
      expect(evidences.find((e) => e.source_slug === 'CGU_CEIS')).toMatchObject(
        {
          state: 'UNKNOWN',
          signal: null,
          summary: null,
          details: null,
          source_reference: null,
          source_url: null,
          collected_at: original.collected_at.toISOString(),
        },
      );
      expect(
        evidences
          .filter((e) => e.source_slug !== 'CGU_CEIS')
          .every((e) => e.state === 'CONFIRMED'),
      ).toBe(true);
      expect(
        await prisma.evidenceNormalized.findUniqueOrThrow({
          where: { id_evidence: original.id_evidence },
        }),
      ).toEqual(original);
    });
    it.each([
      'http://ibama.gov.br/a',
      '/relative',
      'javascript:alert(1)',
      'https://user:secret@ibama.gov.br/a',
    ])('URL inválida %s não é exposta nem inventada', async (sourceUrl) => {
      await prisma.evidenceNormalized.updateMany({
        where: { data_source: { slug: 'IBAMA' } },
        data: { source_reference: null, source_url: sourceUrl },
      });
      expect(
        rows((await http().expect(200)).body).find(
          (e) => e.source_slug === 'IBAMA',
        ),
      ).toMatchObject({ state: 'UNKNOWN', source_url: null, signal: null });
    });
    it('referência sem URL permanece auditável sem criar endereço fictício', async () => {
      await prisma.evidenceNormalized.updateMany({
        where: { data_source: { slug: 'IBAMA' } },
        data: { source_url: null },
      });
      expect(
        rows((await http().expect(200)).body).find(
          (e) => e.source_slug === 'IBAMA',
        ),
      ).toMatchObject({
        state: 'CONFIRMED',
        source_url: null,
        source_reference: expect.any(String),
      });
    });
    it.each(['UNKNOWN', 'NOT_FOUND', 'OUTDATED'] as const)(
      'preserva estado %s e datas, sem sinal confirmatório',
      async (state) => {
        const source = await prisma.evidenceNormalized.findFirstOrThrow({
          where: { cnpj, data_source: { slug: 'CGU_CNEP' } },
        });
        await prisma.evidenceNormalized.update({
          where: { id_evidence: source.id_evidence },
          data: {
            state: state === 'OUTDATED' ? 'CONFIRMED' : state,
            valid_until:
              state === 'OUTDATED' ? new Date(0) : source.valid_until,
            source_reference: null,
            source_url: null,
            summary: null,
            details: null,
          },
        });
        const e = rows((await http().expect(200)).body).find(
          (e) => e.source_slug === 'CGU_CNEP',
        )!;
        expect(e).toMatchObject({
          state,
          signal: null,
          source_reference: null,
          source_url: null,
          collected_at: source.collected_at.toISOString(),
        });
      },
    );
    it('não mistura evidências de outro CNPJ', async () => {
      const other = otherCguCnpj(cnpj),
        reference = faker.string.alphanumeric(20);
      await record.execute({
        cnpj: other,
        sourceSlug: 'IBAMA',
        result: {
          status: 'COLLECTED',
          findings: [{ reference, url: IBAMA_DATASET_URLS.AUTO_INFRACAO }],
        },
      });
      expect(JSON.stringify((await http().expect(200)).body)).not.toContain(
        reference,
      );
    });
    it('OpenAPI declara rota JWT, parâmetros, proveniência e erros padronizados', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('BIOS')
          .addBearerAuth(undefined, 'jwt')
          .build(),
      );
      const operation = document.paths['/companies/{cnpj}/evidences'].get!;
      expect(operation.security).toEqual([{ jwt: [] }]);
      for (const status of ['200', '401', '404', '422', '429', '500', '503'])
        expect(operation.responses).toHaveProperty(status);
      const text = JSON.stringify(operation.responses['200']);
      for (const field of [
        'source',
        'source_slug',
        'source_reference',
        'source_url',
        'published_at',
        'collected_at',
        'valid_until',
      ])
        expect(text).toContain(field);
      const response = operation.responses['200'] as ResponseObject;
      const schema = response.content!['application/json']
        .schema as SchemaObject;
      const categories = schema.properties!.categories as SchemaObject;
      const category = categories.items as SchemaObject;
      const evidences = category.properties!.evidences as SchemaObject;
      const evidence = evidences.items as SchemaObject;
      expect(evidence.properties!.source_url).toMatchObject({
        format: 'uri',
        pattern: '^https:\\/\\/',
      });
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'cnpj', in: 'path', required: true }),
        ]),
      );
    });
  },
);
