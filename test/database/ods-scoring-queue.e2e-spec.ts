import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { IBAMA_DATASET_URLS } from '@modules/ibama/domain/ibama-evidence.mapper.js';
import { OdsScoreRepository } from '@modules/scoring/domain/dtos/repositories/ods-score.repository.js';
import { ODS_SCORE_RULES_VERSION } from '@modules/scoring/domain/ods-score-rules.js';
import {
  RECALCULATE_SCORES_JOB,
  RECALCULATE_STALE_SCORES_JOB,
} from '@modules/scoring/domain/ods-scoring-job.dto.js';
import { RecalculateStaleScoresUseCase } from '@modules/scoring/infra/usecases/recalculate-stale-scores.usecase.js';
import { RequestScoreRecalculationUseCase } from '@modules/scoring/infra/usecases/request-score-recalculation.usecase.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { QueueProvider } from '@shared/domain/providers/queue.provider.js';
import {
  QUEUE_REGISTRY,
  type QueueRegistry,
} from '@shared/infra/providers/bullmq-queue.provider.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { resetCache } from '../support/cache.js';
import { buildDistinctCnpjs } from '../support/cnpj.js';
import { testRedisUrl } from '../support/infrastructure.js';

const redisUrl = testRedisUrl();
const collections = [
  'company_ods_scores',
  'evidence_normalized',
  'evidence_raw',
  'evidence_collection_clocks',
  'company_profile',
  'data_sources',
  'ods',
];

/**
 * UC15 por fila (#80), contra MongoDB e Redis reais: o consumidor real recalcula, a
 * coalescência é do BullMQ, e o cache é o do Redis. Os gatilhos (ingestão do IBAMA,
 * consulta e perfil) são provados nas suítes de cada fluxo.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Recálculo dos índices por fila (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let queue: Queue;
    let record: RecordEvidenceCollectionUseCase;
    let request: RequestScoreRecalculationUseCase;
    let stale: RecalculateStaleScoresUseCase;
    let repository: OdsScoreRepository;
    let cache: CacheProvider;
    let queues: QueueProvider;
    let cnpj: string;

    const scores = (company = cnpj) =>
      prisma.companyOdsScore.findMany({
        where: { cnpj: company },
        orderBy: { ods_number: 'asc' },
      });
    /** O índice sem os campos que mudam a cada cálculo (ids e datas). */
    const stable = async (company = cnpj) =>
      (await scores(company)).map((row) => ({
        ods_number: row.ods_number,
        score_value: row.score_value,
        confidence_value: row.confidence_value,
        evidence_count: row.evidence_count,
        contributions: row.contributions,
        coverage_status: row.coverage_status,
        sources_without_records: row.sources_without_records,
        rules_version: row.rules_version,
      }));
    const collect = (company: string, references: string[] = ['AI-001']) =>
      record.execute({
        cnpj: company,
        sourceSlug: 'IBAMA',
        result: {
          status: 'COLLECTED',
          findings: references.map((reference) => ({
            reference,
            url: IBAMA_DATASET_URLS.AUTO_INFRACAO,
          })),
        },
      });
    async function waitUntil<T>(
      probe: () => Promise<T | null | undefined | false>,
      timeoutMs = 10_000,
    ): Promise<T> {
      const deadline = Date.now() + timeoutMs;

      for (;;) {
        const value = await probe();
        if (value) return value;
        if (Date.now() > deadline) throw new Error('prazo esgotado no teste');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      queue = app
        .get<QueueRegistry>(QUEUE_REGISTRY, { strict: false })
        .get(QueueName.ODS_SCORING) as Queue;
      record = app.get(RecordEvidenceCollectionUseCase, { strict: false });
      request = app.get(RequestScoreRecalculationUseCase, { strict: false });
      stale = app.get(RecalculateStaleScoresUseCase, { strict: false });
      repository = app.get(OdsScoreRepository, { strict: false });
      cache = app.get(CacheProvider, { strict: false });
      queues = app.get(QueueProvider, { strict: false });
    });

    beforeEach(async () => {
      [cnpj] = buildDistinctCnpjs(1);
      await queue.resume();
      await queue.obliterate({ force: true });
      await prisma.reset(collections);
      await prisma.seed(CATALOG_SEEDERS);
      await resetCache(redisUrl);
    });

    afterEach(async () => {
      await queue.resume();
    });

    afterAll(async () => {
      await queue.obliterate({ force: true });
      await prisma.reset(collections);
      await resetCache(redisUrl);
      await app.close();
    });

    it('o job recalculate-scores(cnpj) executa o motor e grava um índice por ODS ativo', async () => {
      await collect(cnpj);

      await expect(request.execute({ cnpj, wait: true })).resolves.toBe(
        'CALCULATED',
      );

      const saved = await scores();
      expect(saved.map(({ ods_number }) => ods_number)).toEqual([13, 15]);
      for (const row of saved) {
        expect(row.rules_version).toBe(ODS_SCORE_RULES_VERSION);
        expect(row.confidence_value).toBeGreaterThanOrEqual(0);
      }
      // A evidência do IBAMA conta no ODS 15 e nada no 13.
      expect(
        saved.find(({ ods_number }) => ods_number === 15)?.evidence_count,
      ).toBe(1);
      expect(
        saved.find(({ ods_number }) => ods_number === 13)?.evidence_count,
      ).toBe(0);
    });

    it('reexecutar sem mudança de evidências produz o mesmo resultado', async () => {
      await collect(cnpj);

      await request.execute({ cnpj, wait: true });
      const first = await stable();
      const firstDates = (await scores()).map(
        ({ calculated_at }) => calculated_at,
      );
      await request.execute({ cnpj, wait: true });

      expect(await stable()).toEqual(first);
      // E de fato recalculou: o instante do cálculo avançou.
      const secondDates = (await scores()).map(
        ({ calculated_at }) => calculated_at,
      );
      expect(secondDates.every((date, i) => date > firstDates[i])).toBe(true);
    });

    it('pedido feito depois de o job terminar gera um job novo: o índice acompanha a evidência nova', async () => {
      await collect(cnpj, ['AI-001']);
      await request.execute({ cnpj, wait: true });
      expect(
        (await scores()).find(({ ods_number }) => ods_number === 15)
          ?.evidence_count,
      ).toBe(1);

      // O job anterior ainda está registrado (jobs concluídos ficam por uma hora): sem a
      // coalescência exata, este pedido seria fundido a ele e devolveria o resultado velho.
      await collect(cnpj, ['AI-001', 'AI-002']);
      await request.execute({ cnpj, wait: true });

      expect(
        (await scores()).find(({ ods_number }) => ods_number === 15)
          ?.evidence_count,
      ).toBe(2);
    });

    it('dez pedidos simultâneos, com o consumidor parado, viram um job só, e um recálculo', async () => {
      await collect(cnpj);
      await queue.pause();

      await Promise.all(
        Array.from({ length: 10 }, () => request.execute({ cnpj })),
      );

      const pending = await queue.getJobs(['waiting', 'delayed']);
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        id: `scores-${cnpj}`,
        name: RECALCULATE_SCORES_JOB,
        data: { cnpj },
      });

      await queue.resume();
      await waitUntil(async () => (await scores()).length === 2);
      await waitUntil(
        async () => (await queue.getJobCounts('completed')).completed === 1,
      );
      expect(await queue.getJobs(['failed'])).toHaveLength(0);
    });

    it('pedidos em sequência rápida, com a evidência mudando entre eles, terminam com o índice da última evidência', async () => {
      // Cada pedido pode cair num job pendente (funde), num ativo (vira um acompanhamento) ou
      // num já concluído (gera outro): em qualquer ordem, nenhuma mudança pode se perder.
      await collect(cnpj, ['AI-001']);
      await request.execute({ cnpj });
      await collect(cnpj, ['AI-001', 'AI-002']);
      await request.execute({ cnpj });
      await collect(cnpj, ['AI-001', 'AI-002', 'AI-003']);
      await request.execute({ cnpj });

      await waitUntil(
        async () =>
          (await scores()).find(({ ods_number }) => ods_number === 15)
            ?.evidence_count === 3,
        15_000,
      );
    });

    it('o cache derivado do CNPJ (perfil, evidências e notas) é invalidado ao final do recálculo', async () => {
      const key = {
        namespace: CacheNamespace.COMPANY_PROFILE,
        identifier: cnpj,
      };
      const scoresKey = {
        namespace: CacheNamespace.COMPANY_SCORES,
        identifier: cnpj,
      };
      const sourceKey = {
        namespace: CacheNamespace.CGU_CEIS,
        identifier: cnpj,
      };
      await cache.set(key, { velho: true }, 600);
      await cache.set(scoresKey, { velho: true }, 600);
      await cache.set(sourceKey, { resposta: 'da fonte' }, 600);
      await collect(cnpj);

      await request.execute({ cnpj, wait: true });

      expect(await cache.get(key)).toBeUndefined();
      expect(await cache.get(scoresKey)).toBeUndefined();
      // O retrato da fonte não depende do índice: continua valendo (sem nova consulta externa).
      expect(await cache.get(sourceKey)).toEqual({ resposta: 'da fonte' });
    });

    it('alterar a versão das regras permite recalcular todas as empresas em lote', async () => {
      const [a, b, untouched] = buildDistinctCnpjs(3);
      for (const company of [a, b, untouched]) {
        await collect(company);
        await request.execute({ cnpj: company, wait: true });
      }
      // Simula o deploy de uma nova versão: duas empresas ficaram com a versão antiga.
      await prisma.companyOdsScore.updateMany({
        where: { cnpj: { in: [a, b] } },
        data: { rules_version: 'rf10-rf11-v0-antiga' },
      });
      const untouchedBefore = (await scores(untouched)).map(
        ({ calculated_at }) => calculated_at,
      );

      // O mesmo job que o agendador publica, pela fila e pelo consumidor reais.
      const result = await queues.enqueueAndWait<
        Record<string, never>,
        { requested: number }
      >(QueueName.ODS_SCORING, RECALCULATE_STALE_SCORES_JOB, {});

      expect(result).toEqual({ requested: 2 });
      await waitUntil(async () => {
        const versions = (
          await prisma.companyOdsScore.findMany({
            where: { cnpj: { in: [a, b] } },
            select: { rules_version: true },
          })
        ).map(({ rules_version }) => rules_version);

        return (
          versions.length === 4 &&
          versions.every((v) => v === ODS_SCORE_RULES_VERSION)
        );
      });
      // Quem já estava na versão atual não foi recalculado.
      expect(
        (await scores(untouched)).map(({ calculated_at }) => calculated_at),
      ).toEqual(untouchedBefore);
    });

    it('a varredura é retomável: sem nada na versão antiga, não pede nada', async () => {
      await collect(cnpj);
      await request.execute({ cnpj, wait: true });

      await expect(stale.execute()).resolves.toEqual({ requested: 0 });
    });

    it('um índice mais antigo nunca sobrescreve um mais novo (recálculos concorrentes)', async () => {
      await collect(cnpj);
      await request.execute({ cnpj, wait: true });
      const [current] = await scores();
      const ods = await repository.findActiveOds();
      const stored = (readAt: Date) =>
        ods.map(({ id, number }) => ({
          cnpj,
          odsId: id,
          odsNumber: number,
          scoreValue: 999,
          confidenceValue: 0.99,
          evidenceCount: 99,
          contributions: [],
          coverageStatus: 'NO_DATA' as const,
          sourcesWithoutRecords: [],
          rulesVersion: ODS_SCORE_RULES_VERSION,
          calculatedAt: readAt,
          location: null,
        }));

      const older = new Date(current.calculated_at.getTime() - 60_000);
      await expect(
        repository.replaceForCompany(cnpj, stored(older)),
      ).resolves.toBe(false);
      expect(
        (await scores()).every(({ evidence_count }) => evidence_count !== 99),
      ).toBe(true);

      const newer = new Date(current.calculated_at.getTime() + 60_000);
      await expect(
        repository.replaceForCompany(cnpj, stored(newer)),
      ).resolves.toBe(true);
      expect(
        (await scores()).every(({ evidence_count }) => evidence_count === 99),
      ).toBe(true);
    });

    it('sem ODS cadastrados o job falha na hora, sem tentativas de repetição, e quem espera é avisado', async () => {
      await prisma.companyOdsScore.deleteMany();
      await prisma.dataSource.updateMany({ data: { ods_id: null } });
      await prisma.ods.deleteMany();

      const startedAt = Date.now();
      const outcome = await request.execute({ cnpj, wait: true });

      expect(outcome).toBe('DEGRADED');
      // Irrecuperável: não esperou as tentativas (3 com backoff) nem o prazo da fila.
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      const [failed] = await queue.getJobs(['failed']);
      expect(failed.failedReason).toContain('Nenhum ODS ativo');
      expect(failed.attemptsMade).toBe(1);
    });
  },
);
