import { readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import type { INestApplication } from '@nestjs/common';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { faker } from '../support/faker.js';
import { GetIbamaCompanyEvidencesUseCase } from '@modules/ibama/infra/usecases/get-ibama-company-evidences.usecase.js';
import { INGEST_IBAMA_COMPANY_JOB } from '@modules/ibama/domain/dtos/providers/ibama-company-job.dto.js';
import { IBAMA_RESOURCES } from '@modules/ibama/domain/ibama-resource.js';
import { INGEST_IBAMA_DUMPS_JOB } from '@modules/ibama/domain/dtos/providers/ibama-ingestion-job.dto.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  QUEUE_REGISTRY,
  type QueueRegistry,
} from '@shared/infra/providers/bullmq-queue.provider.js';
import type { Job, Queue } from 'bullmq';
import { inject } from 'vitest';
import {
  AUTO_INFRACAO_COLUMNS,
  autoInfracaoRowFactory,
  type IbamaCsvRow,
  IBAMA_CNPJ,
  IBAMA_CPF_MASKED,
  IBAMA_OTHER_CNPJ,
  termoEmbargoRowFactory,
  TERMO_EMBARGO_COLUMNS,
  toIbamaCsv,
} from '../factories/ibama/ibama-dump.factory.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { resetSourceRateLimits } from '../support/source-rate-limit.js';
import { buildZip } from '../support/zip.js';

const REDIS_URL = inject('testRedisUrl');
const AUTO_PATH = `/${IBAMA_RESOURCES.AUTO_INFRACAO.segments.join('/')}`;
const EMBARGO_PATH = `/${IBAMA_RESOURCES.TERMO_EMBARGO.segments.join('/')}`;
const DAY_MS = 86_400_000;
const TTL_MS = 2 * DAY_MS;
const JOB_TIMEOUT_MS = 60_000;
const TEMP_PREFIX = 'bios-ibama-';

/**
 * Job avulso IBAMA ponta a ponta (UC14): o job publicado na fila
 * `environmental-evidences` é consumido pelo `IbamaIngestionProcessor` do
 * próprio AppModule, baixa os dois dumps de um servidor local, grava as
 * evidências no MongoDB real e registra a execução em `ingestion_runs`.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Coleta avulsa do IBAMA por CNPJ (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let queue: Queue;
    let listEvidences: ListCompanyEvidencesUseCase;
    let recordCollection: RecordEvidenceCollectionUseCase;
    let server: Server;
    let baseUrl: string;
    let sourceId: string;
    let jobSequence = 0;

    let autoRows: IbamaCsvRow[];
    let embargoRows: IbamaCsvRow[];
    let autoColumns: readonly string[];
    let embargoColumns: readonly string[];
    let autoStatus: number;
    let embargoFailures: number;
    let requests: string[];
    let tempBefore: Set<string>;

    function autoRow(over: IbamaCsvRow = {}) {
      return autoInfracaoRowFactory.build({
        DES_AUTO_INFRACAO: 'texto',
        ...over,
      });
    }

    function embargoRow(over: IbamaCsvRow = {}) {
      return termoEmbargoRowFactory.build({ DES_TAD: 'texto', ...over });
    }

    const tempDirectories = () =>
      new Set(readdirSync(tmpdir()).filter((n) => n.startsWith(TEMP_PREFIX)));

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      queue = app
        .get<QueueRegistry>(QUEUE_REGISTRY, { strict: false })
        .get(QueueName.ENVIRONMENTAL_EVIDENCES) as Queue;
      listEvidences = app.get(ListCompanyEvidencesUseCase, { strict: false });
      recordCollection = app.get(RecordEvidenceCollectionUseCase, {
        strict: false,
      });
      server = createServer((request, response) => {
        requests.push(request.url ?? '');

        if (request.url === AUTO_PATH) {
          if (autoStatus !== 200) {
            response.writeHead(autoStatus).end('erro');

            return;
          }
          const body = buildZip([
            {
              name: 'auto_infracao_2024.csv',
              content: toIbamaCsv(autoColumns, autoRows),
            },
          ]);
          response.writeHead(200).end(body);
        } else if (request.url === EMBARGO_PATH) {
          if (embargoFailures > 0) {
            embargoFailures -= 1;
            response.writeHead(500).end('erro');

            return;
          }
          const body = toIbamaCsv(embargoColumns, embargoRows, {
            quoteAll: true,
            bom: true,
          });
          response.writeHead(200).end(body);
        } else {
          response.writeHead(404).end('não existe');
        }
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    beforeEach(async () => {
      autoRows = [];
      embargoRows = [];
      autoColumns = AUTO_INFRACAO_COLUMNS;
      embargoColumns = TERMO_EMBARGO_COLUMNS;
      autoStatus = 200;
      embargoFailures = 0;
      requests = [];
      tempBefore = tempDirectories();
      await queue.obliterate({ force: true });
      await queue.resume();
      await prisma.reset([
        'data_sources',
        'data_source_request_logs',
        'evidence_raw',
        'evidence_normalized',
        'ingestion_runs',
      ]);
      await prisma.seed(CATALOG_SEEDERS);
      await prisma.dataSource.update({
        where: { slug: 'IBAMA' },
        data: { base_url: baseUrl },
      });
      sourceId = (
        await prisma.dataSource.findUniqueOrThrow({ where: { slug: 'IBAMA' } })
      ).id_data_source;
      await resetSourceRateLimits(REDIS_URL);
    });

    afterEach(async () => {
      // Nenhuma pasta temporária de dump sobra, com sucesso, skip ou falha.
      expect(tempDirectories()).toEqual(tempBefore);
      await queue.obliterate({ force: true });
      await queue.resume();
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.reset([
        'data_sources',
        'data_source_request_logs',
        'evidence_raw',
        'evidence_normalized',
        'ingestion_runs',
      ]);
      await resetSourceRateLimits(REDIS_URL);
      await app.close();
    });

    async function waitUntil<T>(
      probe: () => Promise<T | null | undefined | false>,
      timeoutMs = JOB_TIMEOUT_MS,
    ): Promise<T> {
      const deadline = Date.now() + timeoutMs;

      for (;;) {
        const value = await probe();
        if (value) return value;
        if (Date.now() > deadline) throw new Error('prazo esgotado no teste');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    /**
     * Publica o job do lote e espera o consumidor real concluí-lo (ou
     * esgotá-lo). A política de repetição é escolhida pelo teste: o backoff de
     * produção é de minutos.
     */
    async function runJob({
      attempts = 1,
      backoffMs = 100,
      name = INGEST_IBAMA_COMPANY_JOB,
      payload = { cnpj: IBAMA_CNPJ },
    }: {
      attempts?: number;
      backoffMs?: number;
      name?: string;
      payload?: unknown;
    } = {}) {
      jobSequence += 1;
      const jobId = `ibama-e2e-${jobSequence}`;
      const job = await queue.add(name, payload, {
        jobId,
        attempts,
        backoff: { type: 'fixed', delay: backoffMs },
        removeOnComplete: false,
        removeOnFail: false,
      });
      const state = await waitUntil(async () => {
        const current = await job.getState();

        return current === 'completed' || current === 'failed'
          ? current
          : undefined;
      });
      const finished = (await queue.getJob(jobId)) as Job;

      return { jobId, job: finished, state };
    }

    const runsOf = (jobId: string) =>
      prisma.ingestionRun.findMany({ where: { job_id: jobId } });

    const evidences = (cnpj = IBAMA_CNPJ) =>
      prisma.evidenceNormalized.findMany({
        where: { cnpj },
        orderBy: { evidence_key: 'asc' },
      });

    const lookup = () =>
      app.get(GetIbamaCompanyEvidencesUseCase, { strict: false });
    async function batch(
      status: 'SUCCEEDED' | 'SKIPPED_UNCHANGED' | 'FAILED' | 'RUNNING',
      daysAgo = 0,
      runType: 'SCHEDULED' | 'ON_DEMAND' = 'SCHEDULED',
    ) {
      const startedAt = new Date(Date.now() - daysAgo * DAY_MS - 1000);
      return prisma.ingestionRun.create({
        data: {
          data_source_id: sourceId,
          run_type: runType,
          status,
          job_id: faker.string.uuid(),
          started_at: startedAt,
          finished_at: new Date(startedAt.getTime() + 500),
          ...(runType === 'ON_DEMAND' ? { cnpj: IBAMA_OTHER_CNPJ } : {}),
        },
      });
    }
    async function finishPublished() {
      await queue.resume();
      const jobs = await queue.getJobs([
        'wait',
        'active',
        'completed',
        'failed',
      ]);
      expect(jobs).toHaveLength(1);
      await waitUntil(async () =>
        ['completed', 'failed'].includes(await jobs[0].getState()),
      );
      return (await queue.getJob(jobs[0].id as string)) as Job;
    }

    it('consulta devolve UNKNOWN sem esperar o job, deduplica e depois vira CONFIRMED', async () => {
      autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '1' })];
      embargoRows = [embargoRow({ SEQ_TAD: '1' })];
      await queue.pause();
      const pending = await lookup().execute(IBAMA_CNPJ);
      expect(pending.map((e) => e.state)).toEqual(['UNKNOWN']);
      await lookup().execute(IBAMA_CNPJ);
      expect(requests).toEqual([]);
      const job = await finishPublished();
      expect(await job.getState()).toBe('completed');
      expect(
        (await listEvidences.execute(IBAMA_CNPJ)).map((e) => e.state),
      ).toEqual(['CONFIRMED', 'CONFIRMED']);
      const [run] = await runsOf(job.id as string);
      expect(run).toMatchObject({
        run_type: 'ON_DEMAND',
        cnpj: IBAMA_CNPJ,
        status: 'SUCCEEDED',
        records_upserted: 2,
      });
      const logs = await prisma.dataSourceRequestLog.findMany({
        where: { ingestion_run_id: run.id_ingestion_run },
      });
      expect(logs).toHaveLength(2);
      expect(logs.every((log) => log.trigger === 'ON_DEMAND_JOB')).toBe(true);
      expect(
        (await prisma.evidenceRaw.findMany()).every(
          (raw) =>
            raw.cnpj === IBAMA_CNPJ &&
            raw.ingestion_run_id === run.id_ingestion_run,
        ),
      ).toBe(true);
    });

    it('nenhum registro nos dois dumps confirma NOT_FOUND sem bruto inventado', async () => {
      autoRows = [autoRow({ CPF_CNPJ_INFRATOR: IBAMA_OTHER_CNPJ })];
      const { state } = await runJob();
      expect(state).toBe('completed');
      expect((await evidences()).map((e) => e.state)).toEqual(['NOT_FOUND']);
      expect(await prisma.evidenceRaw.count()).toBe(0);
      expect(await evidences(IBAMA_OTHER_CNPJ)).toHaveLength(0);
    });

    it('avulso substitui somente o CNPJ e a fonte solicitados, ignorando PF, anulados e outros CNPJs', async () => {
      for (const [cnpj, sourceSlug, reference] of [
        [IBAMA_CNPJ, 'IBAMA', 'antigo'],
        [IBAMA_OTHER_CNPJ, 'IBAMA', 'outra-empresa'],
        [IBAMA_CNPJ, 'CGU_CEIS', 'outra-fonte'],
      ]) {
        await recordCollection.execute({
          cnpj,
          sourceSlug,
          result: { status: 'COLLECTED', findings: [{ reference }] },
        });
      }
      const otherBefore = await evidences(IBAMA_OTHER_CNPJ);
      const cguBefore = (await evidences()).find((e) =>
        e.evidence_key.startsWith('CGU_CEIS:'),
      );
      autoRows = [
        autoRow({ SEQ_AUTO_INFRACAO: '1' }),
        autoRow({
          SEQ_AUTO_INFRACAO: '2',
          CPF_CNPJ_INFRATOR: IBAMA_OTHER_CNPJ,
        }),
        autoRow({
          SEQ_AUTO_INFRACAO: '3',
          TP_PESSOA_INFRATOR: 'PF',
          CPF_CNPJ_INFRATOR: IBAMA_CPF_MASKED,
          NOME_INFRATOR: 'NOME SECRETO',
        }),
        autoRow({ SEQ_AUTO_INFRACAO: '4', SIT_CANCELADO: 'S' }),
      ];
      const { jobId, state } = await runJob();
      expect(state).toBe('completed');
      expect((await evidences()).map((e) => e.evidence_key).sort()).toEqual(
        [cguBefore?.evidence_key, 'IBAMA:' + IBAMA_CNPJ + ':AI-1'].sort(),
      );
      expect(await evidences(IBAMA_OTHER_CNPJ)).toEqual(otherBefore);
      expect(
        (await evidences()).find((e) => e.evidence_key.startsWith('CGU_CEIS:')),
      ).toEqual(cguBefore);
      expect((await runsOf(jobId))[0]).toMatchObject({
        records_read: 4,
        records_discarded: 3,
        records_upserted: 1,
      });
      const stored = JSON.stringify([
        await prisma.evidenceRaw.findMany(),
        await evidences(),
        await runsOf(jobId),
      ]);
      expect(stored).not.toContain('NOME SECRETO');
      expect(stored).not.toContain(IBAMA_CPF_MASKED);
    });

    it('repetir coleta avulsa nao duplica bruto nem evidencias', async () => {
      autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '1' })];
      await runJob();
      const before = await evidences();
      await runJob();
      expect((await evidences()).map((e) => e.id_evidence)).toEqual(
        before.map((e) => e.id_evidence),
      );
      expect(await prisma.evidenceRaw.count()).toBe(1);
      expect(await prisma.ingestionRun.count()).toBe(2);
    });

    it.each([true, false])(
      'resposta local valida (encontrada=%s) nao publica nem baixa',
      async (found) => {
        if (found) autoRows = [autoRow()];
        await runJob();
        requests = [];
        await lookup().execute(IBAMA_CNPJ);
        expect(requests).toEqual([]);
        expect(await prisma.ingestionRun.count()).toBe(1);
        expect(await queue.getJobCounts('wait', 'active')).toMatchObject({
          wait: 0,
          active: 0,
        });
      },
    );

    it.each(['SUCCEEDED', 'SKIPPED_UNCHANGED'] as const)(
      'lote %s valido confirma ausencia com data e validade do lote',
      async (status) => {
        if (status === 'SKIPPED_UNCHANGED') await batch('SUCCEEDED', 5);
        const run = await batch(status, 1);
        const result = await lookup().execute(IBAMA_CNPJ);
        expect(result).toMatchObject([
          {
            state: 'NOT_FOUND',
            collectedAt: run.started_at,
            validUntil: new Date((run.started_at as Date).getTime() + TTL_MS),
          },
        ]);
        expect(requests).toEqual([]);
        expect(await queue.count()).toBe(0);
        expect(await prisma.evidenceRaw.count()).toBe(0);
      },
    );

    it.each([
      ['lote vencido', 'SUCCEEDED', 3, 'SCHEDULED'],
      ['lote falho', 'FAILED', 0, 'SCHEDULED'],
      ['lote em andamento', 'RUNNING', 0, 'SCHEDULED'],
      ['avulso recente', 'SUCCEEDED', 0, 'ON_DEMAND'],
    ] as const)(
      '%s nao comprova ausencia no indice inteiro',
      async (_label, status, days, type) => {
        await batch(status, days, type);
        await queue.pause();
        expect(await lookup().execute(IBAMA_CNPJ)).toMatchObject([
          { state: 'UNKNOWN' },
        ]);
        const job = await finishPublished();
        expect(job.name).toBe(INGEST_IBAMA_COMPANY_JOB);
      },
    );

    it('dez consultas concorrentes publicam um unico job para o CNPJ na janela', async () => {
      await queue.pause();
      const results = await Promise.all(
        Array.from({ length: 10 }, () => lookup().execute(IBAMA_CNPJ)),
      );
      expect(
        results.every(
          (result) => result.length === 1 && result[0].state === 'UNKNOWN',
        ),
      ).toBe(true);
      await finishPublished();
      expect(await prisma.ingestionRun.count()).toBe(1);
    });

    it('UNKNOWN vencido pode publicar nova tentativa', async () => {
      await recordCollection.execute({
        cnpj: IBAMA_CNPJ,
        sourceSlug: 'IBAMA',
        collectedAt: new Date(Date.now() - DAY_MS),
        result: { status: 'UNAVAILABLE' },
      });
      await queue.pause();
      expect(await lookup().execute(IBAMA_CNPJ)).toMatchObject([
        { state: 'UNKNOWN' },
      ]);
      await finishPublished();
    });

    it('falha de formato no segundo recurso preserva evidencias antigas OUTDATED e nao grava parcialmente', async () => {
      await recordCollection.execute({
        cnpj: IBAMA_CNPJ,
        sourceSlug: 'IBAMA',
        collectedAt: new Date(Date.now() - 3 * DAY_MS),
        result: {
          status: 'COLLECTED',
          findings: [{ reference: faker.string.uuid() }],
        },
      });
      const before = await evidences();
      autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '9' })];
      embargoColumns = TERMO_EMBARGO_COLUMNS.filter(
        (column) => column !== 'CPF_CNPJ_EMBARGADO',
      );
      const { state } = await runJob();
      expect(state).toBe('failed');
      expect(await evidences()).toEqual(before);
      expect(await prisma.evidenceRaw.count()).toBe(0);
      expect(
        (await listEvidences.execute(IBAMA_CNPJ)).map((e) => e.state),
      ).toEqual(['OUTDATED']);
    });

    it('404 mantem UNKNOWN e nao transforma falha em ausencia confirmada', async () => {
      autoStatus = 404;
      const { state, jobId } = await runJob();
      expect(state).toBe('failed');
      expect((await evidences()).map((e) => e.state)).toEqual(['UNKNOWN']);
      expect((await runsOf(jobId))[0]).toMatchObject({
        run_type: 'ON_DEMAND',
        cnpj: IBAMA_CNPJ,
        status: 'FAILED',
      });
      expect(await prisma.evidenceRaw.count()).toBe(0);
    });

    it('retry reabre a mesma execucao e preserva UNKNOWN ate o sucesso', async () => {
      autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '1' })];
      embargoFailures = 1;
      const jobId = faker.string.uuid();
      const job = await queue.add(
        INGEST_IBAMA_COMPANY_JOB,
        { cnpj: IBAMA_CNPJ },
        {
          jobId,
          attempts: 2,
          backoff: { type: 'fixed', delay: 1000 },
          removeOnComplete: false,
        },
      );
      await waitUntil(async () => (await job.getState()) === 'delayed');
      expect(await runsOf(jobId)).toMatchObject([
        { status: 'RUNNING', run_type: 'ON_DEMAND' },
      ]);
      expect((await evidences()).map((e) => e.state)).toEqual(['UNKNOWN']);
      await waitUntil(async () => (await job.getState()) === 'completed');
      expect(await runsOf(jobId)).toHaveLength(1);
      expect((await runsOf(jobId))[0]).toMatchObject({
        status: 'SUCCEEDED',
        error_message: null,
      });
      expect((await evidences()).map((e) => e.state)).toEqual(['CONFIRMED']);
    });

    it('fonte desabilitada falha uma vez sem HTTP e deixa UNKNOWN', async () => {
      await prisma.dataSource.update({
        where: { slug: 'IBAMA' },
        data: { is_enabled: false },
      });
      const { state, job, jobId } = await runJob({ attempts: 5 });
      expect(state).toBe('failed');
      expect(job.attemptsMade).toBe(1);
      expect(requests).toEqual([]);
      expect((await runsOf(jobId))[0].status).toBe('FAILED');
      expect((await evidences()).map((e) => e.state)).toEqual(['UNKNOWN']);
    });

    it('payload invalido falha sem abrir execucao ou baixar', async () => {
      const { state, job } = await runJob({
        payload: { cnpj: 'invalid' },
        attempts: 5,
      });
      expect(state).toBe('failed');
      expect(job.attemptsMade).toBe(1);
      expect(await prisma.ingestionRun.count()).toBe(0);
      expect(requests).toEqual([]);
    });

    it('avulso SUCCEEDED nao vira referencia de checksum do lote diario', async () => {
      autoRows = [
        autoRow({ SEQ_AUTO_INFRACAO: '1' }),
        autoRow({
          SEQ_AUTO_INFRACAO: '2',
          CPF_CNPJ_INFRATOR: IBAMA_OTHER_CNPJ,
        }),
      ];
      await runJob();
      expect(await evidences(IBAMA_OTHER_CNPJ)).toHaveLength(0);
      const daily = await runJob({ name: INGEST_IBAMA_DUMPS_JOB, payload: {} });
      expect(daily.job.returnvalue).toMatchObject({ outcome: 'SUCCEEDED' });
      expect(await evidences(IBAMA_OTHER_CNPJ)).toHaveLength(1);
    });
  },
);
