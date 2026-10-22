import { createServer, type Server, type ServerResponse } from 'node:http';
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
import {
  FETCH_GHG_INVENTORY_JOB,
  SYNC_GHG_ORGANIZATIONS_JOB,
} from '@modules/ghg/domain/ghg-job.dto.js';
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
  ghgOrganizationFactory,
  ghgOrganizationsPage,
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
      directory: { id: number; name: string; about?: string }[],
      rawOrganizations: unknown,
      inventories: unknown;
    /**
     * `SearchAllOrganizations` como o portal responde: so aceita POST, pagina de
     * 10 sem `maxResultCount`, no maximo 1000 (acima disso, HTTP 400) e `total`
     * com o tamanho do cadastro. `rawOrganizations` substitui a resposta inteira,
     * para os cenarios de formato invalido.
     */
    function searchOrganizations(
      method: string,
      received: string,
      res: ServerResponse,
    ) {
      const json = { 'Content-Type': 'application/json' };
      if (method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      if (rawOrganizations !== undefined) {
        res.writeHead(200, json).end(JSON.stringify(rawOrganizations));
        return;
      }
      const { maxResultCount = 10, skipCount = 0 } = JSON.parse(
        received || '{}',
      ) as { maxResultCount?: number; skipCount?: number };
      if (maxResultCount < 1 || maxResultCount > 1000) {
        res.writeHead(400, json).end(JSON.stringify({ success: false }));
        return;
      }
      res
        .writeHead(200, json)
        .end(
          JSON.stringify(
            ghgOrganizationsPage(directory, { maxResultCount, skipCount }),
          ),
        );
    }
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
        calls.push(`${req.method} ${url.pathname}`);
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const received = Buffer.concat(chunks).toString();
          const send = () => {
            if (status !== 200) {
              res.writeHead(status).end();
              return;
            }
            if (url.pathname.endsWith('SearchAllOrganizations'))
              searchOrganizations(req.method ?? '', received, res);
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
      directory = [{ id: inventory.organizationId, name, about: personal }];
      rawOrganizations = undefined;
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
      await prisma.reset([
        'evidence_normalized',
        'evidence_raw',
        'company_profile',
        'data_source_request_logs',
      ]);
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
          (l) => l.trigger === 'ON_DEMAND_JOB' && l.outcome === 'SUCCESS',
        ),
      ).toBe(true);
      // Inventarios e relatorio sao da empresa; a listagem do cadastro (feita
      // aqui por ser a primeira vez) e da fonte, e nao leva CNPJ.
      expect(logs.filter((l) => l.cnpj === inventory.cnpj)).toHaveLength(2);
      expect(logs.filter((l) => !l.cnpj)).toHaveLength(1);
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
      directory = [];
      const result = await run();
      expect(result[0].state).toBe('UNKNOWN');
      expect(
        result[0].validUntil.getTime() - result[0].collectedAt.getTime(),
      ).toBe(900000);
      await run();
      expect(calls).toHaveLength(1);
      expect(await prisma.evidenceRaw.count()).toBe(0);
    });
    it('confirma uma organizacao fora das 10 primeiras, que e tudo o que o portal devolve sem paginar', async () => {
      directory = [
        ...ghgOrganizationFactory.buildMany(25),
        { id: inventory.organizationId, name, about: personal },
      ];
      const result = await run();
      expect(result[0].state).toBe(EvidenceState.CONFIRMED);
      expect(result[0].sourceReference).toBe(
        `${inventory.organizationId}/${inventory.cycleId}`,
      );
      expect(calls.filter((c) => c.endsWith('SearchAllOrganizations'))).toEqual(
        ['POST /api/services/app/EstatisticaPublica/SearchAllOrganizations'],
      );
    });
    it('cadastro de varias paginas: pede cada uma e confirma a organizacao na ultima', async () => {
      directory = [
        ...ghgOrganizationFactory.buildMany(1200),
        { id: inventory.organizationId, name, about: personal },
      ];
      const result = await run();
      expect(result[0].state).toBe(EvidenceState.CONFIRMED);
      // 1201 organizacoes em paginas de 500.
      expect(
        calls.filter((c) => c.endsWith('SearchAllOrganizations')),
      ).toHaveLength(3);
    });
    describe('sincronizacao diaria do cadastro de organizacoes', () => {
      const ORGANIZATIONS_KEY = {
        namespace: CacheNamespace.GHG_ORGANIZATIONS,
        identifier: 'all',
      };
      const searchCalls = () =>
        calls.filter((c) => c.endsWith('SearchAllOrganizations'));

      /** Publica o job do agendador na fila real e espera o consumidor concluí-lo ou esgotá-lo. */
      async function runSyncJob(attempts = 1) {
        const job = await queue.add(
          SYNC_GHG_ORGANIZATIONS_JOB,
          {},
          {
            attempts,
            backoff: { type: 'fixed', delay: 50 },
            removeOnComplete: false,
            removeOnFail: false,
          },
        );
        const deadline = Date.now() + 15_000;
        for (;;) {
          const state = await job.getState();
          if (state === 'completed' || state === 'failed') break;
          if (Date.now() > deadline) throw new Error('job nao concluiu');
          await new Promise((r) => setTimeout(r, 25));
        }

        return queue.getJob(job.id as string);
      }

      it('o job guarda o cadastro e a coleta de um CNPJ deixa de listar o portal', async () => {
        const finished = await runSyncJob();
        expect(await finished?.getState()).toBe('completed');
        expect(finished?.returnvalue).toEqual({ organizations: 1 });
        const stored = await cache.get<{ organizations: unknown[] }>(
          ORGANIZATIONS_KEY,
        );
        expect(stored?.organizations).toHaveLength(1);
        expect(searchCalls()).toHaveLength(1);
        calls = [];

        const result = await run();

        expect(result[0].state).toBe(EvidenceState.CONFIRMED);
        // So inventarios e relatorio: a lista de organizacoes nao e consultada.
        expect(searchCalls()).toEqual([]);
        expect(calls).toHaveLength(2);
      });

      it('as chamadas do job entram no log como agendadas e sem CNPJ', async () => {
        await runSyncJob();

        const logs = await prisma.dataSourceRequestLog.findMany();
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
          trigger: 'SCHEDULED_JOB',
          outcome: 'SUCCESS',
          http_status: 200,
        });
        expect(logs[0].cnpj ?? null).toBeNull();
      });

      it('CNPJ sem organizacao no cadastro sincronizado nao faz nenhuma chamada externa', async () => {
        directory = ghgOrganizationFactory.buildMany(30);
        await runSyncJob();
        calls = [];

        const result = await run();

        expect(result[0].state).toBe(EvidenceState.UNKNOWN);
        expect(calls).toEqual([]);
      });

      it('falha do portal na sincronizacao mantem o cadastro anterior', async () => {
        await runSyncJob();
        const before = await cache.get<{ syncedAt: string }>(ORGANIZATIONS_KEY);
        status = 500;

        const failed = await runSyncJob(2);

        expect(await failed?.getState()).toBe('failed');
        expect(failed?.attemptsMade).toBe(2);
        expect(await cache.get(ORGANIZATIONS_KEY)).toEqual(before);
      });

      it('resposta incompleta do portal nao substitui o cadastro anterior', async () => {
        await runSyncJob();
        const before = await cache.get<{ syncedAt: string }>(ORGANIZATIONS_KEY);
        rawOrganizations = '<html>login</html>';

        const failed = await runSyncJob();

        expect(await failed?.getState()).toBe('failed');
        expect(await cache.get(ORGANIZATIONS_KEY)).toEqual(before);
      });

      it('sem cadastro guardado (cache limpo), a coleta o refaz uma vez e as seguintes o reaproveitam', async () => {
        await runSyncJob();
        await resetCache(redisUrl);
        calls = [];

        await run();
        expect(searchCalls()).toHaveLength(1);

        // Outra empresa, outra coleta: o cadastro ja esta de volta.
        const other = { cnpj: otherCguCnpj(inventory.cnpj) };
        const source = await prisma.dataSource.findUniqueOrThrow({
          where: { slug: 'BRASIL_API' },
        });
        const { refreshed_at, ...profile } =
          companyProfileResponseFactory.build({
            cnpj: other.cnpj,
            legal_name: faker.company.name(),
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
        calls = [];
        await get.execute(other.cnpj);
        expect(calls).toEqual([]);
      });

      it('fonte desabilitada: o job falha na primeira tentativa, sem repeticao e sem chamada', async () => {
        await prisma.dataSource.update({
          where: { slug: 'GHG_PROTOCOL' },
          data: { is_enabled: false },
        });

        const failed = await runSyncJob(5);

        expect(await failed?.getState()).toBe('failed');
        expect(failed?.attemptsMade).toBe(1);
        expect(failed?.failedReason).toContain('desabilitada');
        expect(calls).toEqual([]);
      });
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
      rawOrganizations = '<html>login</html>';
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
