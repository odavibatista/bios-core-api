import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import type { INestApplication } from '@nestjs/common';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { IbamaResource } from '@modules/ibama/domain/ibama-resource.js';
import { IBAMA_RESOURCES } from '@modules/ibama/domain/ibama-resource.js';
import { combineDumpChecksums } from '@modules/ibama/domain/ibama-dump-checksum.js';
import { INGEST_IBAMA_DUMPS_JOB } from '@modules/ibama/domain/dtos/providers/ibama-ingestion-job.dto.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import {
  buildJobOptions,
  QUEUE_SCHEDULES,
} from '@shared/config/queue.config.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  QUEUE_REGISTRY,
  type QueueRegistry,
} from '@shared/infra/providers/bullmq-queue.provider.js';
import type { Job, Queue } from 'bullmq';
import { formatCnpj } from '@shared/domain/value-objects/cnpj.js';
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
import { testRedisUrl } from '../support/infrastructure.js';

const REDIS_URL = testRedisUrl();
const AUTO_PATH = `/${IBAMA_RESOURCES.AUTO_INFRACAO.segments.join('/')}`;
const EMBARGO_PATH = `/${IBAMA_RESOURCES.TERMO_EMBARGO.segments.join('/')}`;
const DAY_MS = 86_400_000;
const TTL_MS = 2 * DAY_MS;
const JOB_TIMEOUT_MS = 60_000;
const TEMP_PREFIX = 'bios-ibama-';

const sha256 = (content: string | Buffer) =>
  createHash('sha256').update(content).digest('hex');

/**
 * Lote diário do IBAMA ponta a ponta (UC14): o job publicado na fila
 * `ibama-ingestion` é consumido pelo `IbamaIngestionProcessor` do
 * próprio AppModule, baixa os dois dumps de um servidor local, grava as
 * evidências no MongoDB real e registra a execução em `ingestion_runs`.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Lote diário do IBAMA (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let queue: Queue;
    let scoringQueue: Queue;
    let listEvidences: ListCompanyEvidencesUseCase;
    let recordCollection: RecordEvidenceCollectionUseCase;
    let server: Server;
    let baseUrl: string;
    let sourceId: string;
    let jobSequence = 0;

    let autoRows: IbamaCsvRow[];
    let embargoRows: IbamaCsvRow[];
    let autoColumns: readonly string[];
    let autoStatus: number;
    let embargoFailures: number;
    let requests: string[];
    let served: Partial<Record<IbamaResource, string>>;
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
        .get(QueueName.IBAMA_INGESTION) as Queue;
      scoringQueue = app
        .get<QueueRegistry>(QUEUE_REGISTRY, { strict: false })
        .get(QueueName.ODS_SCORING) as Queue;
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
          served.AUTO_INFRACAO = sha256(body);
          response.writeHead(200).end(body);
        } else if (request.url === EMBARGO_PATH) {
          if (embargoFailures > 0) {
            embargoFailures -= 1;
            response.writeHead(500).end('erro');

            return;
          }
          const body = toIbamaCsv(TERMO_EMBARGO_COLUMNS, embargoRows, {
            quoteAll: true,
            bom: true,
          });
          served.TERMO_EMBARGO = sha256(body);
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
      autoStatus = 200;
      embargoFailures = 0;
      requests = [];
      served = {};
      tempBefore = tempDirectories();
      await queue.obliterate({ force: true });
      await prisma.reset([
        'data_sources',
        'data_source_request_logs',
        'evidence_raw',
        'evidence_normalized',
        'ingestion_runs',
        'company_ods_scores',
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
      // Nenhuma pasta temporária de dump sobra, com sucesso, skip ou falha. O job
      // grava a execução como SUCCEEDED antes de apagar as pastas (`finally` do
      // caso de uso), e um teste que só espera o status termina nesse intervalo:
      // por isso se espera a limpeza, e não se confere na hora. Pasta que de fato
      // sobra esgota a espera e reprova o teste.
      await vi.waitFor(
        () => {
          expect(tempDirectories()).toEqual(tempBefore);
        },
        { timeout: 10_000, interval: 50 },
      );
      // O worker também precisa ter terminado o job antes de a fila ser apagada
      // debaixo dele (senão sobra o erro "Missing key for job" no log).
      await vi.waitFor(
        async () => {
          expect(await queue.getActiveCount()).toBe(0);
        },
        { timeout: 10_000, interval: 50 },
      );
      // A ingestão pede o recálculo dos índices (UC15): os jobs do scoring terminam antes
      // de o próximo teste zerar o banco debaixo deles.
      await vi.waitFor(
        async () => {
          const { waiting, active, delayed } = await scoringQueue.getJobCounts(
            'waiting',
            'active',
            'delayed',
          );
          expect(waiting + active + delayed).toBe(0);
        },
        { timeout: 10_000, interval: 50 },
      );
      await queue.obliterate({ force: true });
      await scoringQueue.obliterate({ force: true });
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
        'company_ods_scores',
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
      name = INGEST_IBAMA_DUMPS_JOB,
    }: { attempts?: number; backoffMs?: number; name?: string } = {}) {
      jobSequence += 1;
      const jobId = `ibama-e2e-${jobSequence}`;
      const job = await queue.add(
        name,
        {},
        {
          jobId,
          attempts,
          backoff: { type: 'fixed', delay: backoffMs },
          removeOnComplete: false,
          removeOnFail: false,
        },
      );
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

    function expectedChecksum() {
      return combineDumpChecksums([
        {
          resource: IbamaResource.AUTO_INFRACAO,
          checksum: served.AUTO_INFRACAO ?? '',
        },
        {
          resource: IbamaResource.TERMO_EMBARGO,
          checksum: served.TERMO_EMBARGO ?? '',
        },
      ]);
    }

    describe('dump novo', () => {
      it('o consumidor do core executa o job: grava as evidências e registra a execução', async () => {
        autoRows = [
          autoRow({ SEQ_AUTO_INFRACAO: '1' }),
          autoRow({
            SEQ_AUTO_INFRACAO: '2',
            TP_PESSOA_INFRATOR: 'PF',
            CPF_CNPJ_INFRATOR: IBAMA_CPF_MASKED,
          }),
          autoRow({ SEQ_AUTO_INFRACAO: '3', SIT_CANCELADO: 'S' }),
        ];
        embargoRows = [embargoRow({ SEQ_TAD: '1' })];

        const { jobId, job, state } = await runJob();

        expect(state).toBe('completed');
        const [run] = await runsOf(jobId);
        expect(await runsOf(jobId)).toHaveLength(1);
        expect(run).toMatchObject({
          data_source_id: sourceId,
          run_type: 'SCHEDULED',
          status: 'SUCCEEDED',
          dump_checksum: expectedChecksum(),
          // 3 linhas de autos + 1 de embargo; 1 PF e 1 anulado descartados.
          records_read: 4,
          records_upserted: 2,
          records_discarded: 2,
        });
        expect(run.started_at).toBeInstanceOf(Date);
        expect(run.finished_at).toBeInstanceOf(Date);
        expect(run.error_message).toBeNull();
        expect(job.returnvalue).toMatchObject({
          outcome: 'SUCCEEDED',
          ingestionRunId: run.id_ingestion_run,
          dumpChecksum: run.dump_checksum,
        });
        expect((await evidences()).map((e) => e.evidence_key)).toEqual([
          `IBAMA:${IBAMA_CNPJ}:AI-1`,
          `IBAMA:${IBAMA_CNPJ}:TE-1`,
        ]);
      });

      it('toda evidência da execução tem a data de coleta igual ao início dela, e o bruto aponta a execução', async () => {
        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '1' })];
        embargoRows = [embargoRow({ SEQ_TAD: '1' })];

        const { jobId } = await runJob();

        const [run] = await runsOf(jobId);
        const stored = await evidences();
        expect(stored).toHaveLength(2);
        for (const evidence of stored) {
          expect(evidence.collected_at).toEqual(run.started_at);
          expect(evidence.valid_until).toEqual(
            new Date((run.started_at as Date).getTime() + TTL_MS),
          );
        }
        const raws = await prisma.evidenceRaw.findMany();
        expect(raws).toHaveLength(2);
        expect(
          raws.every((raw) => raw.ingestion_run_id === run.id_ingestion_run),
        ).toBe(true);
      });

      it('registra no log de requisições os dois downloads, ligados à execução', async () => {
        const { jobId } = await runJob();

        const [run] = await runsOf(jobId);
        const logs = await prisma.dataSourceRequestLog.findMany({
          where: { ingestion_run_id: run.id_ingestion_run },
        });
        expect(logs).toHaveLength(2);
        expect(logs.map(({ trigger, outcome }) => [trigger, outcome])).toEqual([
          ['SCHEDULED_JOB', 'SUCCESS'],
          ['SCHEDULED_JOB', 'SUCCESS'],
        ]);
        expect(requests.sort()).toEqual([AUTO_PATH, EMBARGO_PATH].sort());
      });

      it('nenhum CPF nem nome de pessoa chega ao banco, nem às mensagens da execução', async () => {
        autoRows = [
          autoRow({ SEQ_AUTO_INFRACAO: '1' }),
          autoRow({
            SEQ_AUTO_INFRACAO: '2',
            TP_PESSOA_INFRATOR: 'PF',
            CPF_CNPJ_INFRATOR: IBAMA_CPF_MASKED,
            NOME_INFRATOR: 'NOME SECRETO DA PESSOA',
          }),
        ];

        const { jobId } = await runJob();

        const stored = JSON.stringify([
          await prisma.evidenceNormalized.findMany(),
          await prisma.evidenceRaw.findMany(),
          await runsOf(jobId),
        ]);
        expect(stored).not.toContain('123.456.789');
        expect(stored).not.toContain('NOME SECRETO');
      });

      it('um dump alterado dá nova execução bem-sucedida, com novo checksum, e remove o que sumiu', async () => {
        autoRows = [
          autoRow({ SEQ_AUTO_INFRACAO: '1' }),
          autoRow({ SEQ_AUTO_INFRACAO: '2' }),
        ];
        const first = await runJob();
        const firstChecksum = (await runsOf(first.jobId))[0].dump_checksum;

        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '2' })];
        const second = await runJob();

        const [run] = await runsOf(second.jobId);
        expect(run.status).toBe('SUCCEEDED');
        expect(run.dump_checksum).not.toBe(firstChecksum);
        expect(second.job.returnvalue).toMatchObject({
          outcome: 'SUCCEEDED',
          removed: 1,
        });
        expect((await evidences()).map((e) => e.evidence_key)).toEqual([
          `IBAMA:${IBAMA_CNPJ}:AI-2`,
        ]);
      });

      it('mudar só o dump de embargos também reprocessa: o checksum depende dos dois', async () => {
        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '1' })];
        embargoRows = [embargoRow({ SEQ_TAD: '1' })];
        await runJob();

        embargoRows = [
          embargoRow({ SEQ_TAD: '1' }),
          embargoRow({ SEQ_TAD: '2' }),
        ];
        const second = await runJob();

        expect(second.job.returnvalue).toMatchObject({ outcome: 'SUCCEEDED' });
        expect(await evidences()).toHaveLength(3);
      });
    });

    describe('dump idêntico ao da última execução', () => {
      beforeEach(() => {
        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '1' })];
        embargoRows = [embargoRow({ SEQ_TAD: '1' })];
      });

      it('encerra como SKIPPED_UNCHANGED, sem evidência nova nem duplicada', async () => {
        const first = await runJob();
        const before = await evidences();
        const rawBefore = await prisma.evidenceRaw.count();

        const second = await runJob();

        const [run] = await runsOf(second.jobId);
        expect(run).toMatchObject({
          status: 'SKIPPED_UNCHANGED',
          dump_checksum: (await runsOf(first.jobId))[0].dump_checksum,
          records_read: 0,
          records_upserted: 0,
          records_discarded: 0,
        });
        const after = await evidences();
        expect(after.map((e) => e.id_evidence)).toEqual(
          before.map((e) => e.id_evidence),
        );
        expect(await prisma.evidenceRaw.count()).toBe(rawBefore);
        expect(second.job.returnvalue).toMatchObject({
          outcome: 'SKIPPED_UNCHANGED',
          renewed: 2,
        });
      });

      it('renova a validade: a evidência que venceria durante um dump repetido não vence', async () => {
        await runJob();
        // Três dias depois: o dump segue o mesmo, e a validade (2 dias) já passou.
        const longAgo = new Date(Date.now() - 3 * DAY_MS);
        await prisma.evidenceNormalized.updateMany({
          data: {
            collected_at: longAgo,
            valid_until: new Date(longAgo.getTime() + TTL_MS),
          },
        });
        expect(
          (await listEvidences.execute(IBAMA_CNPJ)).map((e) => e.state),
        ).toEqual(['OUTDATED', 'OUTDATED']);

        const second = await runJob();

        const [run] = await runsOf(second.jobId);
        expect(run.status).toBe('SKIPPED_UNCHANGED');
        const listed = await listEvidences.execute(IBAMA_CNPJ);
        expect(listed.map((e) => e.state)).toEqual(['CONFIRMED', 'CONFIRMED']);
        for (const evidence of await evidences()) {
          expect(evidence.collected_at).toEqual(run.started_at);
          expect(evidence.valid_until).toEqual(
            new Date((run.started_at as Date).getTime() + TTL_MS),
          );
        }
      });

      it('renova só a fonte do IBAMA, e só o que ainda responde (nem UNKNOWN, nem outra fonte)', async () => {
        await runJob();
        const old = new Date(Date.now() - 10 * DAY_MS);
        await recordCollection.execute({
          cnpj: IBAMA_CNPJ,
          sourceSlug: 'CGU_CEIS',
          collectedAt: old,
          result: { status: 'COLLECTED', findings: [{ reference: 'S-1' }] },
        });
        await recordCollection.execute({
          cnpj: IBAMA_OTHER_CNPJ,
          sourceSlug: 'IBAMA',
          result: { status: 'UNAVAILABLE' },
        });
        await prisma.evidenceNormalized.updateMany({
          where: { cnpj: IBAMA_OTHER_CNPJ },
          data: {
            collected_at: old,
            valid_until: new Date(old.getTime() + 15 * 60_000),
          },
        });
        const otherSourceBefore = (await evidences()).find((e) =>
          e.evidence_key.startsWith('CGU_CEIS:'),
        );

        await runJob();

        const otherSourceAfter = (await evidences()).find((e) =>
          e.evidence_key.startsWith('CGU_CEIS:'),
        );
        expect(otherSourceAfter?.collected_at).toEqual(old);
        expect(otherSourceAfter?.valid_until).toEqual(
          otherSourceBefore?.valid_until,
        );
        const [unknown] = await evidences(IBAMA_OTHER_CNPJ);
        expect(unknown).toMatchObject({ state: 'UNKNOWN' });
        expect(unknown.collected_at).toEqual(old);
      });

      it('compara só com a última execução bem-sucedida: uma execução pulada ou falha mais recente não confunde', async () => {
        const first = await runJob();
        const checksum = (await runsOf(first.jobId))[0].dump_checksum;
        await prisma.ingestionRun.createMany({
          data: [
            {
              data_source_id: sourceId,
              run_type: 'SCHEDULED',
              status: 'SKIPPED_UNCHANGED',
              job_id: 'mais-recente-pulada',
              dump_checksum: 'outro-checksum',
              finished_at: new Date(Date.now() + 1_000),
            },
            {
              data_source_id: sourceId,
              run_type: 'SCHEDULED',
              status: 'FAILED',
              job_id: 'mais-recente-falha',
              dump_checksum: 'mais-um-checksum',
              finished_at: new Date(Date.now() + 2_000),
            },
          ],
        });

        const second = await runJob();

        const [run] = await runsOf(second.jobId);
        expect(run).toMatchObject({
          status: 'SKIPPED_UNCHANGED',
          dump_checksum: checksum,
        });
      });
    });

    describe('fonte indisponível: retry, backoff e evidências preservadas', () => {
      async function seedPreviousLoad() {
        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '1' })];
        embargoRows = [embargoRow({ SEQ_TAD: '1' })];
        await runJob();
        // Dado diferente no próximo dump: se ele fosse processado, a carga mudaria.
        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '9' })];

        return evidences();
      }

      it('o job é repetido, a execução é uma só e só vira FAILED depois da última tentativa', async () => {
        const previous = await seedPreviousLoad();
        embargoFailures = 100;

        jobSequence += 1;
        const jobId = `ibama-e2e-${jobSequence}`;
        const job = await queue.add(
          INGEST_IBAMA_DUMPS_JOB,
          {},
          {
            jobId,
            attempts: 2,
            backoff: { type: 'fixed', delay: 1_500 },
            removeOnFail: false,
          },
        );

        // Entre as tentativas o job espera o backoff; a execução segue RUNNING.
        await waitUntil(async () => (await job.getState()) === 'delayed');
        expect(await runsOf(jobId)).toMatchObject([{ status: 'RUNNING' }]);

        await waitUntil(async () => (await job.getState()) === 'failed');
        const failed = (await queue.getJob(jobId)) as Job;
        const runs = await runsOf(jobId);
        expect(failed.attemptsMade).toBe(2);
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({ status: 'FAILED' });
        expect(runs[0].error_message).toContain('TERMO_EMBARGO');
        expect(runs[0].error_message).toContain('HTTP 500');
        expect(runs[0].finished_at).toBeInstanceOf(Date);

        // As evidências anteriores seguem exatamente como estavam.
        const after = await evidences();
        expect(after.map((e) => e.evidence_key)).toEqual(
          previous.map((e) => e.evidence_key),
        );
        expect(after.map((e) => e.collected_at)).toEqual(
          previous.map((e) => e.collected_at),
        );
      }, 30_000);

      it('a repetição que dá certo conclui a mesma execução, sem deixar outra', async () => {
        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '1' })];
        embargoFailures = 1;

        const { jobId, state, job } = await runJob({
          attempts: 3,
          backoffMs: 200,
        });

        expect(state).toBe('completed');
        expect(job.attemptsMade).toBe(2);
        const runs = await runsOf(jobId);
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({ status: 'SUCCEEDED' });
        expect(runs[0].error_message).toBeNull();
        expect(await evidences()).toHaveLength(1);
      }, 30_000);

      it('404 no dump falha com a mensagem apontando a base_url do catálogo', async () => {
        const previous = await seedPreviousLoad();
        autoStatus = 404;

        const { jobId, state } = await runJob();

        expect(state).toBe('failed');
        const [run] = await runsOf(jobId);
        expect(run.status).toBe('FAILED');
        expect(run.error_message).toContain('base_url');
        expect((await evidences()).map((e) => e.evidence_key)).toEqual(
          previous.map((e) => e.evidence_key),
        );
      });

      it('dump com coluna ausente falha (formato) e não remove nada', async () => {
        const previous = await seedPreviousLoad();
        autoColumns = AUTO_INFRACAO_COLUMNS.filter(
          (column) => column !== 'CPF_CNPJ_INFRATOR',
        );

        const { jobId, state } = await runJob();

        expect(state).toBe('failed');
        const [run] = await runsOf(jobId);
        expect(run.status).toBe('FAILED');
        expect(run.error_message).toContain('fora do formato esperado');
        expect((await evidences()).map((e) => e.evidence_key)).toEqual(
          previous.map((e) => e.evidence_key),
        );
      });
    });

    describe('jobs que não devem ser repetidos', () => {
      it('fonte desabilitada falha na primeira tentativa, sem baixar nada, e a execução fica FAILED', async () => {
        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '1' })];
        await runJob();
        await prisma.dataSource.update({
          where: { slug: 'IBAMA' },
          data: { is_enabled: false },
        });
        requests = [];

        const { jobId, state, job } = await runJob({ attempts: 5 });

        expect(state).toBe('failed');
        expect(job.attemptsMade).toBe(1);
        expect(requests).toEqual([]);
        const [run] = await runsOf(jobId);
        expect(run.status).toBe('FAILED');
        expect(run.error_message).toContain('desabilitada');
        expect(await evidences()).toHaveLength(1);
      });

      it('job de nome desconhecido falha sem repetição e não abre execução', async () => {
        const { state, job } = await runJob({
          attempts: 5,
          name: 'ingest-outra-coisa',
        });

        expect(state).toBe('failed');
        expect(job.attemptsMade).toBe(1);
        expect(job.failedReason).toContain('Job desconhecido');
        expect(await prisma.ingestionRun.count()).toBe(0);
        expect(requests).toEqual([]);
      });
    });

    describe('recálculo dos índices (UC14 passo 5 → UC15, #80)', () => {
      const odsScores = (cnpj: string) =>
        prisma.companyOdsScore.findMany({
          where: { cnpj },
          orderBy: { ods_number: 'asc' },
        });
      const infractions = async (cnpj: string) =>
        (await odsScores(cnpj)).find(({ ods_number }) => ods_number === 15)
          ?.evidence_count;

      it('pede o recálculo do índice de cada empresa que a carga gravou, e o consumidor o executa', async () => {
        autoRows = [
          autoRow({ SEQ_AUTO_INFRACAO: '1' }),
          autoRow({
            SEQ_AUTO_INFRACAO: '2',
            CPF_CNPJ_INFRATOR: formatCnpj(IBAMA_OTHER_CNPJ),
          }),
        ];

        await runJob();

        await waitUntil(
          async () =>
            (await infractions(IBAMA_CNPJ)) === 1 &&
            (await infractions(IBAMA_OTHER_CNPJ)) === 1,
        );
        // Um índice por ODS ativo, para as duas empresas.
        expect(await odsScores(IBAMA_CNPJ)).toHaveLength(2);
        expect(await odsScores(IBAMA_OTHER_CNPJ)).toHaveLength(2);
      });

      it('a empresa que sumiu do dump também é recalculada: a evidência removida deixa de contar', async () => {
        autoRows = [
          autoRow({ SEQ_AUTO_INFRACAO: '1' }),
          autoRow({
            SEQ_AUTO_INFRACAO: '2',
            CPF_CNPJ_INFRATOR: formatCnpj(IBAMA_OTHER_CNPJ),
          }),
        ];
        await runJob();
        await waitUntil(
          async () => (await infractions(IBAMA_OTHER_CNPJ)) === 1,
        );

        // O IBAMA deixou de listar a segunda empresa (dump diferente: nova execução).
        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '1' })];
        await runJob();

        await waitUntil(
          async () => (await infractions(IBAMA_OTHER_CNPJ)) === 0,
        );
        expect(await infractions(IBAMA_CNPJ)).toBe(1);
      });

      it('dump idêntico (SKIPPED_UNCHANGED) não pede recálculo: nada mudou além da validade', async () => {
        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '1' })];
        await runJob();
        await waitUntil(async () => (await infractions(IBAMA_CNPJ)) === 1);
        // O índice aparece no banco um instante antes de o job ser dado como concluído:
        // a linha de base só vale depois de o recálculo da primeira carga terminar de fato.
        await vi.waitFor(
          async () => {
            const counts = await scoringQueue.getJobCounts(
              'waiting',
              'active',
              'delayed',
              'completed',
            );
            expect(counts.waiting + counts.active + counts.delayed).toBe(0);
            expect(counts.completed).toBe(1);
          },
          { timeout: 10_000, interval: 50 },
        );
        const { completed } = await scoringQueue.getJobCounts('completed');

        const { job } = await runJob();

        expect(job.returnvalue).toMatchObject({ outcome: 'SKIPPED_UNCHANGED' });
        expect(await scoringQueue.getJobCounts('waiting', 'active')).toEqual({
          waiting: 0,
          active: 0,
        });
        expect((await scoringQueue.getJobCounts('completed')).completed).toBe(
          completed,
        );
      });
    });

    describe('agendador do BullMQ', () => {
      it('o job produzido pelo agendador, com as opções declaradas, é aceito e executado pelo consumidor', async () => {
        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '1' })];
        const [declared] = QUEUE_SCHEDULES;
        const schedulerId = 'ibama-e2e-scheduler';

        await queue.upsertJobScheduler(
          schedulerId,
          { every: 300, limit: 1 },
          {
            name: declared.jobName,
            opts: buildJobOptions(declared.queue, declared.retry),
          },
        );

        const run = await waitUntil(async () =>
          prisma.ingestionRun.findFirst({ where: { status: 'SUCCEEDED' } }),
        );
        await queue.removeJobScheduler(schedulerId);

        expect(run.job_id).toContain(schedulerId);
        expect(await evidences()).toHaveLength(1);
      });

      it('o agendamento declarado carrega a política de repetição própria do lote', async () => {
        const [declared] = QUEUE_SCHEDULES;
        const schedulerId = 'ibama-e2e-template';

        await queue.upsertJobScheduler(
          schedulerId,
          { pattern: '0 4 * * *' },
          {
            name: declared.jobName,
            opts: buildJobOptions(declared.queue, declared.retry),
          },
        );

        const scheduler = await queue.getJobScheduler(schedulerId);
        await queue.removeJobScheduler(schedulerId);

        expect(scheduler?.template?.opts).toMatchObject({
          attempts: 5,
          backoff: { type: 'exponential', delay: 300_000 },
        });
      });
    });
  },
);
