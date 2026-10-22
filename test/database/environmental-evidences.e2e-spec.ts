import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { inject } from 'vitest';
import type { Queue } from 'bullmq';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { GetCompanyEnvironmentalEvidencesUseCase } from '@modules/evidences/infra/usecases/get-company-environmental-evidences.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import type { CompanyEnvironmentalEvidencesResponse } from '@modules/evidences/domain/company-environmental-evidences.dto.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import {
  QUEUE_REGISTRY,
  type QueueRegistry,
} from '@shared/infra/providers/bullmq-queue.provider.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { companyProfileResponseFactory } from '../factories/companies/company-profile.factory.js';
import {
  otherCguCnpj,
  cguRowFactory,
} from '../factories/cgu/cgu-sanction.factory.js';
import {
  ghgEnvelope,
  ghgInventoryFactory,
  ghgOrganizationsPage,
  ghgPdf,
} from '../factories/ghg/ghg.factory.js';
import { faker } from '../support/faker.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { resetCache } from '../support/cache.js';
import { resetSourceRateLimits } from '../support/source-rate-limit.js';
const redisUrl = inject('testRedisUrl');
const flatten = (response: CompanyEnvironmentalEvidencesResponse) =>
  response.categories.flatMap((g) => g.evidences);
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'UC07 consolidacao com Mongo, filas, cache, HTTP e PDF reais',
  () => {
    let app: INestApplication,
      prisma: PrismaService,
      get: GetCompanyEnvironmentalEvidencesUseCase,
      record: RecordEvidenceCollectionUseCase,
      server: Server,
      base: string,
      queues: Queue[];
    let inventory: ReturnType<typeof ghgInventoryFactory.build>,
      name: string,
      calls: string[],
      personal: string;
    let status: Record<string, number>,
      delay: Record<string, number>,
      pages: Record<string, unknown[]>;
    const run = () => get.execute(inventory.cnpj);
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
        if (Date.now() > end) throw new Error('workers nao concluiram');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      get = app.get(GetCompanyEnvironmentalEvidencesUseCase);
      record = app.get(RecordEvidenceCollectionUseCase);
      const registry = app.get<QueueRegistry>(QUEUE_REGISTRY);
      queues = [
        registry.get(QueueName.ENVIRONMENTAL_EVIDENCES)!,
        registry.get(QueueName.GHG_INVENTORY)!,
      ];
      server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const source =
          url.pathname === '/ceis'
            ? 'CGU_CEIS'
            : url.pathname === '/cnep'
              ? 'CGU_CNEP'
              : 'GHG_PROTOCOL';
        calls.push(url.pathname);
        const send = () => {
          if (status[source] !== 200) {
            res.writeHead(status[source]).end();
            return;
          }
          if (source !== 'GHG_PROTOCOL') {
            const page = Number(url.searchParams.get('pagina'));
            res
              .writeHead(200, { 'Content-Type': 'application/json' })
              .end(JSON.stringify(pages[source][page - 1] ?? []));
          } else if (url.pathname.endsWith('SearchAllOrganizations')) {
            // Como o portal: so POST; o cadastro cabe numa pagina de 1000.
            if (req.method !== 'POST') {
              res.writeHead(405).end();
              return;
            }
            res
              .writeHead(200, { 'Content-Type': 'application/json' })
              .end(
                JSON.stringify(
                  ghgOrganizationsPage(
                    [{ id: inventory.organizationId, name, about: personal }],
                    { maxResultCount: 1000 },
                  ),
                ),
              );
          } else if (url.pathname.endsWith('GetReportedInventories')) {
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(
              JSON.stringify(
                ghgEnvelope({
                  inventories: [
                    { year: inventory.year, cycleId: inventory.cycleId },
                  ],
                  errorMsg: null,
                  warnMsg: null,
                }),
              ),
            );
          } else if (url.pathname.startsWith('/GenerateReport/'))
            res
              .writeHead(200, { 'Content-Type': 'application/pdf' })
              .end(ghgPdf(inventory.cnpj, inventory.year, personal));
          else res.writeHead(404).end();
        };
        if (delay[source]) setTimeout(send, delay[source]);
        else send();
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    beforeEach(async () => {
      await settle();
      for (const queue of queues) await queue.obliterate({ force: true });
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
      status = { CGU_CEIS: 200, CGU_CNEP: 200, GHG_PROTOCOL: 200 };
      delay = {};
      const row = () =>
        cguRowFactory.build({
          sancionado: { codigoFormatado: inventory.cnpj, nome: personal },
        });
      pages = { CGU_CEIS: [[row()], []], CGU_CNEP: [[row()], []] };
      for (const [slug, path] of [
        ['CGU_CEIS', '/ceis'],
        ['CGU_CNEP', '/cnep'],
        ['GHG_PROTOCOL', ''],
      ])
        await prisma.dataSource.update({
          where: { slug },
          data: { base_url: base + path, request_timeout_ms: 10000 },
        });
      // IBAMA usa o indice local: nenhum download de dump nesta suite de orquestracao.
      await prisma.dataSource.update({
        where: { slug: 'IBAMA' },
        data: { is_enabled: false },
      });
      await record.execute({
        cnpj: inventory.cnpj,
        sourceSlug: 'IBAMA',
        result: {
          status: 'COLLECTED',
          findings: [
            {
              reference: faker.string.alphanumeric(10),
              url: 'https://dadosabertos.ibama.gov.br/',
            },
          ],
        },
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
    });
    afterAll(async () => {
      await settle();
      for (const queue of queues) await queue.obliterate({ force: true });
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await prisma.reset([
        'evidence_normalized',
        'evidence_raw',
        'company_profile',
        'data_source_request_logs',
        'ingestion_runs',
      ]);
      await app.close();
    });
    it('reune quatro fontes, separa conduta administrativa e preserva proveniencia sem dados pessoais', async () => {
      const result = await run();
      const rows = flatten(result);
      expect(rows).toHaveLength(4);
      expect(rows.every((e) => e.state === 'CONFIRMED')).toBe(true);
      expect(
        result.categories
          .find((g) => g.category === 'CONDUTA_ADMINISTRATIVA')!
          .evidences.map((e) => e.source_slug),
      ).toEqual(['CGU_CEIS', 'CGU_CNEP']);
      expect(
        result.categories
          .find((g) => g.category === 'INFRACAO_AMBIENTAL')!
          .evidences.map((e) => e.source_slug),
      ).toEqual(['IBAMA']);
      expect(rows.find((e) => e.source_slug === 'GHG_PROTOCOL')).toMatchObject({
        signal: 'POSITIVE',
        ods_number: 13,
        source_reference: `${inventory.organizationId}/${inventory.cycleId}`,
        source_url: expect.stringContaining(
          'sistema-registropublicodeemissoesapi.fgv.br',
        ),
      });
      expect(
        rows.every(
          (e) =>
            e.source_reference &&
            e.source_url &&
            e.collected_at &&
            e.valid_until,
        ),
      ).toBe(true);
      expect(calls).toHaveLength(7);
      const jobs = await queues[0].getCompleted();
      expect(jobs.map((j) => j.name)).toEqual(['fetch-cgu-evidences']);
      expect(jobs[0].returnvalue).toEqual({ status: 'COLLECTED' });
      expect((await queues[1].getCompleted()).map((j) => j.name)).toEqual([
        'fetch-ghg-inventory',
      ]);
      expect(
        (await prisma.dataSourceRequestLog.findMany()).every(
          (l) => l.trigger === 'ON_DEMAND_JOB',
        ),
      ).toBe(true);
      expect(
        JSON.stringify([
          result,
          await prisma.evidenceRaw.findMany(),
          await prisma.dataSourceRequestLog.findMany(),
        ]),
      ).not.toContain(personal);
    });
    it('consultas concorrentes compartilham jobs por CNPJ e conservam resposta final', async () => {
      const results = await Promise.all([run(), run()]);
      for (const result of results)
        expect(flatten(result).every((e) => e.state === 'CONFIRMED')).toBe(
          true,
        );
      expect(calls).toHaveLength(7);
      expect(await queues[0].getCompletedCount()).toBe(1);
      expect(await queues[1].getCompletedCount()).toBe(1);
      expect(await prisma.evidenceRaw.count()).toBe(3);
    });
    it('reutiliza persistencia valida mesmo sem cache e nao renova datas nem jobs', async () => {
      const first = await run(),
        count = calls.length;
      await resetCache(redisUrl);
      expect(await run()).toEqual(first);
      expect(calls).toHaveLength(count);
      expect(await queues[0].getCompletedCount()).toBe(1);
      expect(await queues[1].getCompletedCount()).toBe(1);
    });
    it('cache sanitizado recomp?e evidencias sem duplicar bruto ou alterar datas', async () => {
      const first = await run(),
        count = calls.length;
      await prisma.evidenceNormalized.deleteMany({
        where: {
          data_source: {
            slug: { in: ['CGU_CEIS', 'CGU_CNEP', 'GHG_PROTOCOL'] },
          },
        },
      });
      for (const queue of queues) await queue.obliterate({ force: true });
      const next = await run();
      expect(
        flatten(next).map((e) => ({
          source: e.source_slug,
          date: e.collected_at,
          until: e.valid_until,
        })),
      ).toEqual(
        flatten(first).map((e) => ({
          source: e.source_slug,
          date: e.collected_at,
          until: e.valid_until,
        })),
      );
      expect(calls).toHaveLength(count);
      expect(await prisma.evidenceRaw.count()).toBe(3);
    });
    it.each(['CGU_CEIS', 'CGU_CNEP', 'GHG_PROTOCOL'])(
      'queda isolada %s gera UNKNOWN neutro e mantem outras fontes',
      async (slug) => {
        status[slug] = 503;
        const rows = flatten(await run());
        expect(rows.find((e) => e.source_slug === slug)).toMatchObject({
          state: 'UNKNOWN',
          signal: null,
          source_reference: null,
          source_url: null,
        });
        expect(
          rows
            .filter((e) => e.source_slug !== slug)
            .every((e) => e.state === 'CONFIRMED'),
        ).toBe(true);
        expect(rows).toHaveLength(4);
      },
    );
    it('IBAMA sem indice nem lote fica UNKNOWN e falha avulsa nao interfere na CGU', async () => {
      await prisma.evidenceNormalized.deleteMany({
        where: { data_source: { slug: 'IBAMA' } },
      });
      const rows = flatten(await run());
      await settle();
      expect(rows.find((e) => e.source_slug === 'IBAMA')).toMatchObject({
        state: 'UNKNOWN',
        signal: null,
      });
      expect(
        rows
          .filter((e) => e.source_slug !== 'IBAMA')
          .every((e) => e.state === 'CONFIRMED'),
      ).toBe(true);
      expect((await queues[0].getFailed()).map((j) => j.name)).toEqual([
        'ingest-ibama-company',
      ]);
    });
    it('ausencia CGU confirmada nao recebe bonus e GHG sem inventario nao prova ausencia', async () => {
      pages.CGU_CEIS = [[]];
      pages.CGU_CNEP = [[]];
      status.GHG_PROTOCOL = 404;
      const rows = flatten(await run());
      expect(
        rows
          .filter((e) => e.source_slug.startsWith('CGU_'))
          .every((e) => e.state === 'NOT_FOUND' && e.signal === null),
      ).toBe(true);
      expect(rows.find((e) => e.source_slug === 'GHG_PROTOCOL')).toMatchObject({
        state: 'UNKNOWN',
        signal: null,
      });
    });
    it.each(['CGU_CEIS', 'CGU_CNEP', 'GHG_PROTOCOL'])(
      'falha %s preserva referencia e datas anteriores como OUTDATED',
      async (slug) => {
        const before = flatten(await run()).find(
          (e) => e.source_slug === slug,
        )!;
        const old = new Date(Date.now() - 40 * 86400000);
        await prisma.evidenceNormalized.updateMany({
          where: { data_source: { slug } },
          data: { collected_at: old, valid_until: new Date(0) },
        });
        await resetCache(redisUrl);
        for (const queue of queues) await queue.obliterate({ force: true });
        status[slug] = 500;
        const after = flatten(await run()).find((e) => e.source_slug === slug)!;
        expect(after).toMatchObject({
          state: 'OUTDATED',
          signal: null,
          source_reference: before.source_reference,
          source_url: before.source_url,
          collected_at: old.toISOString(),
          valid_until: new Date(0).toISOString(),
        });
      },
    );
    it('timeout GHG respeita prazo e entrega IBAMA/CGU; fila GHG continua independente', async () => {
      delay.GHG_PROTOCOL = 500;
      await prisma.dataSource.update({
        where: { slug: 'GHG_PROTOCOL' },
        data: { request_timeout_ms: 80 },
      });
      const start = Date.now(),
        rows = flatten(await run());
      expect(Date.now() - start).toBeLessThan(2500);
      expect(rows.find((e) => e.source_slug === 'GHG_PROTOCOL')).toMatchObject({
        state: 'UNKNOWN',
        signal: null,
      });
      expect(
        rows
          .filter((e) => e.source_slug !== 'GHG_PROTOCOL')
          .every((e) => e.state === 'CONFIRMED'),
      ).toBe(true);
      await settle();
    });
    it('fila ambiental pausada devolve UNKNOWN no limite sem impedir GHG', async () => {
      await queues[0].pause();
      try {
        const start = Date.now(),
          rows = flatten(await run());
        expect(Date.now() - start).toBeLessThan(5000);
        expect(
          rows
            .filter((e) => e.source_slug.startsWith('CGU_'))
            .every((e) => e.state === 'UNKNOWN' && e.signal === null),
        ).toBe(true);
        expect(rows.find((e) => e.source_slug === 'GHG_PROTOCOL')!.state).toBe(
          'CONFIRMED',
        );
      } finally {
        await queues[0].resume();
        await settle();
      }
    });
    it('CNPJ diferente nao recebe registros da primeira empresa e entrada invalida nao publica', async () => {
      await run();
      await expect(get.execute('invalido')).rejects.toThrow(/CNPJ/);
      const other = otherCguCnpj(inventory.cnpj);
      const rows = flatten(await get.execute(other));
      expect(
        rows
          .filter((e) => e.source_slug.startsWith('CGU_'))
          .every((e) => e.state === 'NOT_FOUND'),
      ).toBe(true);
      expect(rows.find((e) => e.source_slug === 'GHG_PROTOCOL')!.state).toBe(
        'UNKNOWN',
      );
      expect(
        (
          await prisma.evidenceNormalized.findMany({
            where: { cnpj: inventory.cnpj },
          })
        ).every((e) => e.state === 'CONFIRMED'),
      ).toBe(true);
    });
  },
);
