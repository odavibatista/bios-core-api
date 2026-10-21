import { Test } from '@nestjs/testing';
import { IngestionRunStatus, IngestionRunType } from '@prisma/client';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { buildChecksum } from '@test/factories/data-sources/ingestion-run.factory.js';
import { faker } from '@test/support/faker.js';
import { PrismaIngestionRunRepository } from './prisma-ingestion-run.repository.js';

function storedRun(over: Record<string, unknown> = {}) {
  return {
    id_ingestion_run: faker.database.mongodbObjectId(),
    data_source_id: faker.database.mongodbObjectId(),
    run_type: IngestionRunType.SCHEDULED,
    status: IngestionRunStatus.RUNNING,
    job_id: faker.string.alphanumeric(12),
    dump_checksum: undefined,
    started_at: faker.date.recent(),
    finished_at: undefined,
    ...over,
  };
}

describe('PrismaIngestionRunRepository', () => {
  const findFirst = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  let repository: PrismaIngestionRunRepository;

  const dataSourceId = faker.database.mongodbObjectId();
  const jobId = `repeat:ibama-daily-ingestion:${faker.number.int()}`;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaIngestionRunRepository,
        {
          provide: PrismaService,
          useValue: { ingestionRun: { findFirst, create, update } },
        },
      ],
    }).compile();

    repository = moduleRef.get(PrismaIngestionRunRepository);
  });

  describe('openScheduled', () => {
    it('cria a execução em RUNNING quando o job ainda não tem uma', async () => {
      const startedAt = faker.date.recent();
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(
        storedRun({ data_source_id: dataSourceId, job_id: jobId }),
      );

      const run = await repository.openScheduled({
        dataSourceId,
        jobId,
        startedAt,
      });

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          data_source_id: dataSourceId,
          job_id: jobId,
          run_type: IngestionRunType.SCHEDULED,
        },
      });
      expect(create).toHaveBeenCalledWith({
        data: {
          data_source_id: dataSourceId,
          run_type: IngestionRunType.SCHEDULED,
          job_id: jobId,
          status: IngestionRunStatus.RUNNING,
          started_at: startedAt,
        },
      });
      expect(update).not.toHaveBeenCalled();
      expect(run).toMatchObject({
        dataSourceId,
        status: IngestionRunStatus.RUNNING,
        dumpChecksum: null,
        finishedAt: null,
      });
    });

    it('reabre a execução do job em vez de criar outra, limpando o erro e o término', async () => {
      const startedAt = faker.date.recent();
      const existing = storedRun({
        status: IngestionRunStatus.RUNNING,
        data_source_id: dataSourceId,
      });
      findFirst.mockResolvedValue(existing);
      update.mockResolvedValue({ ...existing, started_at: startedAt });

      const run = await repository.openScheduled({
        dataSourceId,
        jobId,
        startedAt,
      });

      expect(create).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith({
        where: { id_ingestion_run: existing.id_ingestion_run },
        data: {
          status: IngestionRunStatus.RUNNING,
          started_at: startedAt,
          finished_at: null,
          error_message: null,
        },
      });
      expect(run.id).toBe(existing.id_ingestion_run);
      expect(run.startedAt).toBe(startedAt);
    });
  });

  describe('openOnDemand', () => {
    it('grava tipo e CNPJ para não confundir o avulso com uma carga completa', async () => {
      const cnpj = '11222333000181';
      const startedAt = faker.date.recent();
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(storedRun());
      await repository.openOnDemand({ dataSourceId, jobId, startedAt, cnpj });
      expect(findFirst).toHaveBeenCalledWith({
        where: {
          data_source_id: dataSourceId,
          job_id: jobId,
          run_type: IngestionRunType.ON_DEMAND,
          cnpj,
        },
      });
      expect(create).toHaveBeenCalledWith({
        data: {
          data_source_id: dataSourceId,
          job_id: jobId,
          started_at: startedAt,
          run_type: IngestionRunType.ON_DEMAND,
          cnpj,
          status: IngestionRunStatus.RUNNING,
        },
      });
    });

    it('reabre a mesma execução avulsa na repetição do job', async () => {
      const existing = storedRun({ run_type: IngestionRunType.ON_DEMAND });
      findFirst.mockResolvedValue(existing);
      update.mockResolvedValue(existing);
      const run = await repository.openOnDemand({
        dataSourceId,
        jobId,
        startedAt: new Date(),
        cnpj: '11222333000181',
      });
      expect(run.id).toBe(existing.id_ingestion_run);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('findLastConfirmedBatch', () => {
    it('aceita reconfirmação, mas somente de execução agendada', async () => {
      const stored = storedRun({
        status: IngestionRunStatus.SKIPPED_UNCHANGED,
      });
      findFirst.mockResolvedValue(stored);
      expect(
        await repository.findLastConfirmedBatch(dataSourceId),
      ).toMatchObject({
        id: stored.id_ingestion_run,
        status: IngestionRunStatus.SKIPPED_UNCHANGED,
      });
      expect(findFirst).toHaveBeenCalledWith({
        where: {
          data_source_id: dataSourceId,
          run_type: IngestionRunType.SCHEDULED,
          status: {
            in: [
              IngestionRunStatus.SUCCEEDED,
              IngestionRunStatus.SKIPPED_UNCHANGED,
            ],
          },
        },
        orderBy: { finished_at: 'desc' },
      });
    });

    it('sem carga completa não confirma ausência de empresa', async () => {
      findFirst.mockResolvedValue(null);
      await expect(
        repository.findLastConfirmedBatch(dataSourceId),
      ).resolves.toBeNull();
    });
  });

  describe('findByJob', () => {
    it('devolve a execução da fonte para o job', async () => {
      const stored = storedRun({ dump_checksum: buildChecksum() });
      findFirst.mockResolvedValue(stored);

      await expect(repository.findByJob(dataSourceId, jobId)).resolves.toEqual({
        id: stored.id_ingestion_run,
        dataSourceId: stored.data_source_id,
        status: IngestionRunStatus.RUNNING,
        dumpChecksum: stored.dump_checksum,
        startedAt: stored.started_at,
        finishedAt: null,
      });
      expect(findFirst).toHaveBeenCalledWith({
        where: {
          data_source_id: dataSourceId,
          job_id: jobId,
        },
      });
    });

    it('devolve null quando o job não abriu execução', async () => {
      findFirst.mockResolvedValue(null);

      await expect(
        repository.findByJob(dataSourceId, jobId),
      ).resolves.toBeNull();
    });
  });

  describe('finish', () => {
    it('grava o resultado, o checksum, as contagens e o término', async () => {
      const finishedAt = faker.date.recent();
      const dumpChecksum = buildChecksum();
      update.mockResolvedValue(storedRun());

      await repository.finish('run-1', {
        status: 'SUCCEEDED',
        dumpChecksum,
        recordsRead: 10,
        recordsUpserted: 7,
        recordsDiscarded: 3,
        finishedAt,
      });

      expect(update).toHaveBeenCalledWith({
        where: { id_ingestion_run: 'run-1' },
        data: {
          status: 'SUCCEEDED',
          dump_checksum: dumpChecksum,
          records_read: 10,
          records_upserted: 7,
          records_discarded: 3,
          error_message: null,
          finished_at: finishedAt,
        },
      });
    });

    it('grava a mensagem de erro da falha', async () => {
      const finishedAt = faker.date.recent();
      update.mockResolvedValue(storedRun());

      await repository.finish('run-1', {
        status: 'FAILED',
        recordsRead: 0,
        recordsUpserted: 0,
        recordsDiscarded: 0,
        errorMessage: 'fonte fora do ar',
        finishedAt,
      });

      expect(update).toHaveBeenCalledWith({
        where: { id_ingestion_run: 'run-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          dump_checksum: null,
          error_message: 'fonte fora do ar',
        }),
      });
    });
  });

  describe('findLastSucceeded', () => {
    it('busca a SUCCEEDED mais recente da fonte pelo término', async () => {
      const stored = storedRun({
        status: IngestionRunStatus.SUCCEEDED,
        dump_checksum: buildChecksum(),
        finished_at: faker.date.recent(),
      });
      findFirst.mockResolvedValue(stored);

      const run = await repository.findLastSucceeded(dataSourceId);

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          data_source_id: dataSourceId,
          status: IngestionRunStatus.SUCCEEDED,
          run_type: IngestionRunType.SCHEDULED,
        },
        orderBy: { finished_at: 'desc' },
      });
      expect(run).toMatchObject({
        status: IngestionRunStatus.SUCCEEDED,
        dumpChecksum: stored.dump_checksum,
        finishedAt: stored.finished_at,
      });
    });

    it('devolve null quando a fonte nunca teve uma execução bem-sucedida', async () => {
      findFirst.mockResolvedValue(null);

      await expect(
        repository.findLastSucceeded(dataSourceId),
      ).resolves.toBeNull();
    });
  });
});
