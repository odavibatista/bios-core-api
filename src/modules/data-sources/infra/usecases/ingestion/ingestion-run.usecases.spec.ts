import { Test } from '@nestjs/testing';
import { IngestionRunStatus } from '@prisma/client';
import {
  buildChecksum,
  ingestionRunFactory,
} from '@test/factories/data-sources/ingestion-run.factory.js';
import { faker } from '@test/support/faker.js';
import { UnknownDataSourceError } from '../../../domain/dtos/errors/unknown-data-source.error.js';
import { DataSourceRepository } from '../../../domain/dtos/repositories/data-source.repository.js';
import { IngestionRunRepository } from '../../../domain/dtos/repositories/ingestion-run.repository.js';
import { FailIngestionRunUseCase } from './fail-ingestion-run.usecase.js';
import { FindLastConfirmedBatchUseCase } from './find-last-confirmed-batch.usecase.js';
import { FindLastSucceededIngestionRunUseCase } from './find-last-succeeded-ingestion-run.usecase.js';
import {
  FinishIngestionRunUseCase,
  MAX_RUN_ERROR_MESSAGE_LENGTH,
} from './finish-ingestion-run.usecase.js';
import { OpenIngestionRunUseCase } from './open-ingestion-run.usecase.js';

describe('casos de uso das execuções de ingestão', () => {
  const dataSourceRepository = {
    findRequestConfig: vi.fn<DataSourceRepository['findRequestConfig']>(),
  };
  const runRepository = {
    openScheduled: vi.fn<IngestionRunRepository['openScheduled']>(),
    openOnDemand: vi.fn<IngestionRunRepository['openOnDemand']>(),
    findLastConfirmedBatch:
      vi.fn<IngestionRunRepository['findLastConfirmedBatch']>(),
    findByJob: vi.fn<IngestionRunRepository['findByJob']>(),
    finish: vi.fn<IngestionRunRepository['finish']>(),
    findLastSucceeded: vi.fn<IngestionRunRepository['findLastSucceeded']>(),
  };
  const sourceId = faker.database.mongodbObjectId();
  const slug = 'IBAMA';

  let open: OpenIngestionRunUseCase;
  let finish: FinishIngestionRunUseCase;
  let fail: FailIngestionRunUseCase;
  let findLast: FindLastSucceededIngestionRunUseCase;
  let confirmedBatch: FindLastConfirmedBatchUseCase;

  beforeEach(async () => {
    dataSourceRepository.findRequestConfig.mockResolvedValue({
      id: sourceId,
      slug,
      baseUrl: faker.internet.url(),
      isEnabled: true,
      rateLimitPerMinute: null,
      requestTimeoutMs: null,
    });
    runRepository.finish.mockResolvedValue();

    const moduleRef = await Test.createTestingModule({
      providers: [
        OpenIngestionRunUseCase,
        FinishIngestionRunUseCase,
        FailIngestionRunUseCase,
        FindLastSucceededIngestionRunUseCase,
        FindLastConfirmedBatchUseCase,
        { provide: DataSourceRepository, useValue: dataSourceRepository },
        { provide: IngestionRunRepository, useValue: runRepository },
      ],
    }).compile();

    open = moduleRef.get(OpenIngestionRunUseCase);
    finish = moduleRef.get(FinishIngestionRunUseCase);
    fail = moduleRef.get(FailIngestionRunUseCase);
    findLast = moduleRef.get(FindLastSucceededIngestionRunUseCase);
    confirmedBatch = moduleRef.get(FindLastConfirmedBatchUseCase);
  });

  describe('OpenIngestionRunUseCase', () => {
    it('abre a execução do job na fonte do catálogo', async () => {
      const startedAt = faker.date.recent();
      const jobId = faker.string.alphanumeric(10);
      const opened = ingestionRunFactory.build({
        status: IngestionRunStatus.RUNNING,
      });
      runRepository.openScheduled.mockResolvedValue(opened);

      await expect(
        open.execute({ sourceSlug: slug, jobId, startedAt }),
      ).resolves.toBe(opened);

      expect(dataSourceRepository.findRequestConfig).toHaveBeenCalledWith(slug);
      expect(runRepository.openScheduled).toHaveBeenCalledWith({
        dataSourceId: sourceId,
        jobId,
        startedAt,
      });
    });

    it('recusa fonte que não está no catálogo, sem abrir execução', async () => {
      dataSourceRepository.findRequestConfig.mockResolvedValue(null);

      await expect(
        open.execute({
          sourceSlug: slug,
          jobId: faker.string.alphanumeric(10),
          startedAt: new Date(),
        }),
      ).rejects.toBeInstanceOf(UnknownDataSourceError);

      expect(runRepository.openScheduled).not.toHaveBeenCalled();
    });
  });

  describe('execução avulsa e referência de lote', () => {
    it('CNPJ informado abre uma execução ON_DEMAND', async () => {
      const run = ingestionRunFactory.build();
      runRepository.openOnDemand.mockResolvedValue(run);
      const input = {
        sourceSlug: slug,
        cnpj: '11222333000181',
        jobId: faker.string.alphanumeric(10),
        startedAt: new Date(),
      };
      expect(await open.execute(input)).toBe(run);
      expect(runRepository.openOnDemand).toHaveBeenCalledWith({
        dataSourceId: sourceId,
        cnpj: input.cnpj,
        jobId: input.jobId,
        startedAt: input.startedAt,
      });
      expect(runRepository.openScheduled).not.toHaveBeenCalled();
    });

    it('obtém a última reconfirmação de um lote completo', async () => {
      const run = ingestionRunFactory.build({
        status: IngestionRunStatus.SKIPPED_UNCHANGED,
      });
      runRepository.findLastConfirmedBatch.mockResolvedValue(run);
      expect(await confirmedBatch.execute(slug)).toBe(run);
      expect(runRepository.findLastConfirmedBatch).toHaveBeenCalledWith(
        sourceId,
      );
    });

    it('devolve null quando não há lote completo', async () => {
      runRepository.findLastConfirmedBatch.mockResolvedValue(null);
      await expect(confirmedBatch.execute(slug)).resolves.toBeNull();
    });

    it('recusa consulta de lote para fonte inexistente', async () => {
      dataSourceRepository.findRequestConfig.mockResolvedValue(null);
      await expect(confirmedBatch.execute(slug)).rejects.toBeInstanceOf(
        UnknownDataSourceError,
      );
      expect(runRepository.findLastConfirmedBatch).not.toHaveBeenCalled();
    });
  });

  describe('FinishIngestionRunUseCase', () => {
    it('encerra a execução com o resultado e as contagens', async () => {
      const finishedAt = faker.date.recent();
      const dumpChecksum = buildChecksum();

      await finish.execute({
        runId: 'run-1',
        status: 'SUCCEEDED',
        dumpChecksum,
        recordsRead: 100,
        recordsUpserted: 80,
        recordsDiscarded: 20,
        finishedAt,
      });

      expect(runRepository.finish).toHaveBeenCalledWith('run-1', {
        status: 'SUCCEEDED',
        dumpChecksum,
        recordsRead: 100,
        recordsUpserted: 80,
        recordsDiscarded: 20,
        errorMessage: undefined,
        finishedAt,
      });
    });

    it.each(['SUCCEEDED', 'SKIPPED_UNCHANGED', 'FAILED'] as const)(
      'aceita o encerramento %s',
      async (status) => {
        await finish.execute({
          runId: 'run-1',
          status,
          recordsRead: 0,
          recordsUpserted: 0,
          recordsDiscarded: 0,
        });

        expect(runRepository.finish).toHaveBeenCalledWith(
          'run-1',
          expect.objectContaining({ status }),
        );
      },
    );

    it('usa o instante da chamada quando o término não é informado', async () => {
      const before = Date.now();

      await finish.execute({
        runId: 'run-1',
        status: 'SKIPPED_UNCHANGED',
        recordsRead: 0,
        recordsUpserted: 0,
        recordsDiscarded: 0,
      });

      const [, outcome] = runRepository.finish.mock.calls[0];
      expect(outcome.finishedAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('trunca a mensagem de erro longa, para o registro não crescer sem limite', async () => {
      await finish.execute({
        runId: 'run-1',
        status: 'FAILED',
        recordsRead: 0,
        recordsUpserted: 0,
        recordsDiscarded: 0,
        errorMessage: 'x'.repeat(MAX_RUN_ERROR_MESSAGE_LENGTH * 3),
      });

      const [, outcome] = runRepository.finish.mock.calls[0];
      expect(outcome.errorMessage).toHaveLength(MAX_RUN_ERROR_MESSAGE_LENGTH);
    });

    it('mantém inteira a mensagem que cabe no limite', async () => {
      const errorMessage = faker.lorem.sentence();

      await finish.execute({
        runId: 'run-1',
        status: 'FAILED',
        recordsRead: 0,
        recordsUpserted: 0,
        recordsDiscarded: 0,
        errorMessage,
      });

      const [, outcome] = runRepository.finish.mock.calls[0];
      expect(outcome.errorMessage).toBe(errorMessage);
    });
  });

  describe('FailIngestionRunUseCase', () => {
    it('marca como FAILED a execução do job, com a mensagem e as contagens zeradas', async () => {
      const jobId = faker.string.alphanumeric(10);
      const run = ingestionRunFactory.build({
        status: IngestionRunStatus.RUNNING,
      });
      runRepository.findByJob.mockResolvedValue(run);

      await expect(
        fail.execute({ sourceSlug: slug, jobId, errorMessage: 'sem dump' }),
      ).resolves.toBe(true);

      expect(runRepository.findByJob).toHaveBeenCalledWith(sourceId, jobId);
      expect(runRepository.finish).toHaveBeenCalledWith(
        run.id,
        expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'sem dump',
          recordsRead: 0,
          recordsUpserted: 0,
          recordsDiscarded: 0,
        }),
      );
    });

    it('não faz nada quando o job nem chegou a abrir uma execução', async () => {
      runRepository.findByJob.mockResolvedValue(null);

      await expect(
        fail.execute({
          sourceSlug: slug,
          jobId: faker.string.alphanumeric(10),
          errorMessage: 'banco fora',
        }),
      ).resolves.toBe(false);

      expect(runRepository.finish).not.toHaveBeenCalled();
    });

    it('recusa fonte que não está no catálogo', async () => {
      dataSourceRepository.findRequestConfig.mockResolvedValue(null);

      await expect(
        fail.execute({
          sourceSlug: slug,
          jobId: faker.string.alphanumeric(10),
          errorMessage: 'x',
        }),
      ).rejects.toBeInstanceOf(UnknownDataSourceError);
    });
  });

  describe('FindLastSucceededIngestionRunUseCase', () => {
    it('devolve a última execução bem-sucedida da fonte', async () => {
      const last = ingestionRunFactory.build({ dataSourceId: sourceId });
      runRepository.findLastSucceeded.mockResolvedValue(last);

      await expect(findLast.execute(slug)).resolves.toBe(last);

      expect(runRepository.findLastSucceeded).toHaveBeenCalledWith(sourceId);
    });

    it('devolve null quando a fonte nunca teve uma', async () => {
      runRepository.findLastSucceeded.mockResolvedValue(null);

      await expect(findLast.execute(slug)).resolves.toBeNull();
    });

    it('recusa fonte que não está no catálogo', async () => {
      dataSourceRepository.findRequestConfig.mockResolvedValue(null);

      await expect(findLast.execute(slug)).rejects.toBeInstanceOf(
        UnknownDataSourceError,
      );
    });
  });
});
