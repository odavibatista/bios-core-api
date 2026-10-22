import { createServer, type Server } from 'node:http';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import {
  EvidenceState,
  EvidenceSignal,
  EvidenceCategory,
} from '@prisma/client';
import { inject } from 'vitest';
import type { Queue } from 'bullmq';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { GetGhgCompanyEvidencesUseCase } from '@modules/ghg/infra/usecases/get-ghg-company-evidences.usecase.js';
import { FETCH_GHG_INVENTORY_JOB } from '@modules/ghg/domain/ghg-job.dto.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import {
  QUEUE_REGISTRY,
  type QueueRegistry,
} from '@shared/infra/providers/bullmq-queue.provider.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { companyProfileResponseFactory } from '../factories/companies/company-profile.factory.js';
import { otherCguCnpj } from '../factories/cgu/cgu-sanction.factory.js';
import {
  ghgEnvelope,
  ghgInventoryFactory,
  ghgPdf,
} from '../factories/ghg/ghg.factory.js';
import { faker } from '../support/faker.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { resetCache } from '../support/cache.js';
import { resetSourceRateLimits } from '../support/source-rate-limit.js';
const redisUrl = inject('testRedisUrl');
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'GHG com fila, HTTP, PDF, Mongo e Redis reais',
  () => {
    let app: INestApplication,
      prisma: PrismaService,
      get: GetGhgCompanyEvidencesUseCase,
      queue: Queue,
      cache: CacheProvider,
      server: Server,
      base: string;
    let inventory: ReturnType<typeof ghgInventoryFactory.build>,
      name: string,
      personal: string,
      calls: string[],
      status: number,
      delay: number,
      report: Buffer,
      organizations: unknown,
      inventories: unknown;
    const run = () => get.execute(inventory.cnpj);
    const dirs = async () =>
      new Set(
        (await readdir(tmpdir())).filter((n) => n.startsWith('bios-ghg-')),
      );
    async function settle() {
      const deadline = Date.now() + 10000;
      while (await queue.getActiveCount()) {
        if (Date.now() > deadline) throw new Error('worker nao concluiu');
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      get = app.get(GetGhgCompanyEvidencesUseCase);
      cache = app.get(CacheProvider);
      queue = app
        .get<QueueRegistry>(QUEUE_REGISTRY)
        .get(QueueName.GHG_INVENTORY)!;
      server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        calls.push(url.pathname);
        const send = () => {
          if (status !== 200) {
            res.writeHead(status).end();
            return;
          }
          if (url.pathname.endsWith('GetAllOrganizations'))
            res
              .writeHead(200, { 'Content-Type': 'application/json' })
              .end(JSON.stringify(organizations));
          else if (url.pathname.endsWith('GetReportedInventories'))
            res
              .writeHead(200, { 'Content-Type': 'application/json' })
              .end(JSON.stringify(inventories));
          else if (url.pathname.startsWith('/GenerateReport/'))
            res
              .writeHead(200, { 'Content-Type': 'application/pdf' })
              .end(report);
          else res.writeHead(404).end();
        };
        if (delay) setTimeout(send, delay);
        else send();
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    beforeEach(async () => {
      await settle();
      await queue.obliterate({ force: true });
      await resetCache(redisUrl);
      await resetSourceRateLimits(redisUrl);
      await prisma.reset([
        'evidence_normalized',
        'evidence_raw',
        'company_profile',
        'data_source_request_logs',
        'ingestion_runs',
        'data_sources',
      ]);
      await prisma.seed(CATALOG_SEEDERS);
      inventory = ghgInventoryFactory.build();
      name = faker.company.name();
      personal = faker.internet.email();
      calls = [];
      status = 200;
      delay = 0;
      report = ghgPdf(inventory.cnpj, inventory.year, personal);
      organizations = ghgEnvelope([
        { id: inventory.organizationId, name, about: personal },
      ]);
      inventories = ghgEnvelope({
        inventories: [{ year: inventory.year, cycleId: inventory.cycleId }],
        errorMsg: null,
        warnMsg: null,
      });
      const source = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: 'BRASIL_API' },
      });
      const { refreshed_at, ...profile } = companyProfileResponseFactory.build({
        cnpj: inventory.cnpj,
        legal_name: name,
        trade_name: null,
      });
      await prisma.companyProfile.create({
        data: {
          ...profile,
          refreshed_at: new Date(refreshed_at),
          cadastral_source_id: source.id_data_source,
          content_hash: faker.string.hexadecimal({ length: 64, prefix: '' }),
        },
      });
      await prisma.dataSource.update({
        where: { slug: 'GHG_PROTOCOL' },
        data: { base_url: base, request_timeout_ms: 10000 },
      });
    });
    afterAll(async () => {
      await settle();
      await queue.obliterate({ force: true });
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await app.close();
    });
    it('fila real confirma CNPJ/ano, persiste somente whitelist e link original', async () => {
      const before = await dirs();
      const result = await run();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        state: EvidenceState.CONFIRMED,
        category: EvidenceCategory.EMISSAO_GEE,
        signal: EvidenceSignal.POSITIVE,
        odsNumber: 13,
        sourceReference: `${inventory.organizationId}/${inventory.cycleId}`,
        sourceUrl: expect.stringContaining(
          'sistema-registropublicodeemissoesapi.fgv.br',
        ),
        publishedAt: null,
        details: {
          inventoryYear: inventory.year,
          organizationId: inventory.organizationId,
          cycleId: inventory.cycleId,
        },
      });
      const raw = await prisma.evidenceRaw.findMany();
      expect(raw).toHaveLength(1);
      expect(raw[0].payload).toEqual(inventory);
      expect(result[0].rawEvidenceId).toBeTruthy();
      expect(
        result[0].validUntil.getTime() - result[0].collectedAt.getTime(),
      ).toBe(2592000000);
      const logs = await prisma.dataSourceRequestLog.findMany();
      expect(logs).toHaveLength(3);
      expect(
        logs.every(
          (l) =>
            l.trigger === 'ON_DEMAND_JOB' &&
            l.cnpj === inventory.cnpj &&
            l.outcome === 'SUCCESS',
        ),
      ).toBe(true);
      const cached = await cache.get({
        namespace: CacheNamespace.GHG_INVENTORY,
        identifier: inventory.cnpj,
      });
      expect(JSON.stringify([raw, result, logs, cached])).not.toContain(
        personal,
      );
      expect(await dirs()).toEqual(before);
    });
    it('reutiliza persistencia valida e conserva datas sem novas chamadas', async () => {
      const first = await run();
      expect(await run()).toEqual(first);
      expect(calls).toHaveLength(3);
      expect(await prisma.evidenceRaw.count()).toBe(1);
    });
    it('cache HTTP sanitizado conserva datas ao reprocessar pela fila', async () => {
      const first = await run();
      await prisma.evidenceNormalized.deleteMany({});
      await queue.obliterate({ force: true });
      const repeated = await run();
      expect(repeated[0].collectedAt).toEqual(first[0].collectedAt);
      expect(repeated[0].validUntil).toEqual(first[0].validUntil);
      expect(calls).toHaveLength(3);
      expect(await prisma.evidenceRaw.count()).toBe(1);
    });
    it('catalogo sem candidato gera UNKNOWN por 15 minutos, sem NOT_FOUND', async () => {
      organizations = ghgEnvelope([]);
      const result = await run();
      expect(result[0].state).toBe('UNKNOWN');
      expect(
        result[0].validUntil.getTime() - result[0].collectedAt.getTime(),
      ).toBe(900000);
      await run();
      expect(calls).toHaveLength(1);
      expect(await prisma.evidenceRaw.count()).toBe(0);
    });
    it('organizacao sem inventario gera UNKNOWN', async () => {
      inventories = ghgEnvelope({
        inventories: [],
        errorMsg: null,
        warnMsg: null,
      });
      expect((await run())[0].state).toBe('UNKNOWN');
      expect(calls).toHaveLength(2);
    });
    it('PDF de outra PJ nunca e atribuido pela semelhanca do nome', async () => {
      report = ghgPdf(otherCguCnpj(inventory.cnpj), inventory.year);
      expect((await run())[0].state).toBe('UNKNOWN');
      expect(await prisma.evidenceRaw.count()).toBe(0);
    });
    it('ano do relatorio deve corresponder ao catalogo', async () => {
      report = ghgPdf(inventory.cnpj, inventory.year - 1);
      expect((await run())[0].state).toBe('UNKNOWN');
    });
    it.each([404, 206, 500])('HTTP %s nao confirma ausencia', async (code) => {
      status = code;
      expect((await run())[0].state).toBe('UNKNOWN');
      expect(await prisma.evidenceRaw.count()).toBe(0);
    });
    it('HTML de erro em HTTP200 nao e catalogo vazio', async () => {
      organizations = '<html>login</html>';
      expect((await run())[0].state).toBe('UNKNOWN');
      expect(await prisma.evidenceRaw.count()).toBe(0);
    });
    it('PDF invalido nao entra no bruto/cache e limpa temporario', async () => {
      const before = await dirs();
      report = Buffer.from('<html>404</html>');
      expect((await run())[0].state).toBe('UNKNOWN');
      await settle();
      expect(await dirs()).toEqual(before);
      expect(await prisma.evidenceRaw.count()).toBe(0);
    });
    it('fonte desabilitada nao consulta rede nem cache de outra coleta', async () => {
      await prisma.dataSource.update({
        where: { slug: 'GHG_PROTOCOL' },
        data: { is_enabled: false },
      });
      expect((await run())[0].state).toBe('UNKNOWN');
      expect(calls).toEqual([]);
    });
    it('timeout retorna UNKNOWN no prazo e outra fonte segue disponivel', async () => {
      await prisma.dataSource.update({
        where: { slug: 'GHG_PROTOCOL' },
        data: { request_timeout_ms: 80 },
      });
      delay = 500;
      const start = Date.now();
      const result = await run();
      expect(result[0].state).toBe('UNKNOWN');
      expect(Date.now() - start).toBeLessThan(2000);
      await app.get(RecordEvidenceCollectionUseCase).execute({
        cnpj: inventory.cnpj,
        sourceSlug: 'CGU_CEIS',
        result: { status: 'COLLECTED', findings: [] },
      });
      expect(
        (
          await app.get(ListCompanyEvidencesUseCase).execute(inventory.cnpj)
        ).find((e) => e.sourceSlug === 'CGU_CEIS')?.state,
      ).toBe('NOT_FOUND');
      await settle();
    });
    it('falha preserva resposta anterior como OUTDATED', async () => {
      await run();
      const old = new Date(Date.now() - 2592001000);
      await prisma.evidenceNormalized.updateMany({
        data: { collected_at: old, valid_until: new Date(0) },
      });
      await cache.delete({
        namespace: CacheNamespace.GHG_INVENTORY,
        identifier: inventory.cnpj,
      });
      await queue.obliterate({ force: true });
      status = 500;
      const result = await run();
      expect(result[0].state).toBe('OUTDATED');
      expect(result[0].collectedAt).toEqual(old);
      expect(await prisma.evidenceRaw.count()).toBe(1);
    });
    it('rate limit vale para cada chamada e nao persiste parcial', async () => {
      await prisma.dataSource.update({
        where: { slug: 'GHG_PROTOCOL' },
        data: { rate_limit_per_minute: 1 },
      });
      expect((await run())[0].state).toBe('UNKNOWN');
      expect(calls).toHaveLength(1);
      expect(await prisma.evidenceRaw.count()).toBe(0);
      expect(
        await prisma.dataSourceRequestLog.count({
          where: { outcome: 'RATE_LIMITED' },
        }),
      ).toBe(1);
    });
    it('job malformado falha sem repetir nem fazer HTTP', async () => {
      const job = await queue.add(
        FETCH_GHG_INVENTORY_JOB,
        { cnpj: 'invalid' },
        { attempts: 3 },
      );
      const deadline = Date.now() + 5000;
      while ((await job.getState()) !== 'failed') {
        if (Date.now() > deadline) throw new Error('job nao falhou');
        await new Promise((r) => setTimeout(r, 20));
      }
      expect((await queue.getJob(job.id!))?.attemptsMade).toBe(1);
      expect(calls).toEqual([]);
    });
  },
);
