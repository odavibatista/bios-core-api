import { RequestTrigger } from '@prisma/client';
import { FETCH_CGU_EVIDENCES_JOB } from '../../domain/cgu-job.dto.js';
import { GetCguCompanyEvidencesUseCase } from '@modules/cgu/infra/usecases/get-cgu-company-evidences.usecase.js';
import { Test } from '@nestjs/testing';
import { type Job, UnrecoverableError } from 'bullmq';
import { FailIngestionRunUseCase } from '@modules/data-sources/infra/usecases/ingestion/fail-ingestion-run.usecase.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { buildChecksum } from '@test/factories/data-sources/ingestion-run.factory.js';
import { faker } from '@test/support/faker.js';
import {
  IbamaDumpUnavailableError,
  IbamaSourceDisabledError,
} from '@modules/ibama/domain/dtos/errors/ibama-ingestion.errors.js';
import {
  type IbamaIngestionJobResult,
  INGEST_IBAMA_DUMPS_JOB,
} from '@modules/ibama/domain/dtos/providers/ibama-ingestion-job.dto.js';
import { IBAMA_CNPJ } from '@test/factories/ibama/ibama-dump.factory.js';
import { INGEST_IBAMA_COMPANY_JOB } from '@modules/ibama/domain/dtos/providers/ibama-company-job.dto.js';
import { IngestIbamaCompanyUseCase } from '@modules/ibama/infra/usecases/ingest-ibama-company.usecase.js';
import { IngestIbamaDumpsUseCase } from '@modules/ibama/infra/usecases/ingest-ibama-dumps.usecase.js';
import { EnvironmentalEvidencesProcessor } from './environmental-evidences.processor.js';

const JOB_ID = `repeat:ibama-daily-ingestion:${faker.number.int()}`;
const ATTEMPTS = 5;

interface JobShape {
  name: string;
  data: unknown;
  id: string | undefined;
  attemptsMade: number;
  attempts: number | undefined;
}

/** `undefined` explícito vale: é como se descreve um job sem id ou sem política de tentativas. */
function buildJob(over: Partial<JobShape> = {}): Job<unknown> {
  const { name, data, id, attemptsMade, attempts }: JobShape = {
    name: INGEST_IBAMA_DUMPS_JOB,
    data: {},
    id: JOB_ID,
    attemptsMade: 0,
    attempts: ATTEMPTS,
    ...over,
  };

  return { name, data, id, attemptsMade, opts: { attempts } } as Job<unknown>;
}

function buildResult(): IbamaIngestionJobResult {
  return {
    outcome: 'SUCCEEDED',
    ingestionRunId: faker.database.mongodbObjectId(),
    dumpChecksum: buildChecksum(),
    recordsRead: 10,
    recordsUpserted: 8,
    recordsDiscarded: 2,
    removed: 0,
    renewed: 0,
  };
}

describe('EnvironmentalEvidencesProcessor', () => {
  const ingest = { execute: vi.fn<IngestIbamaDumpsUseCase['execute']>() };
  const company = { execute: vi.fn<IngestIbamaCompanyUseCase['execute']>() };
  const fail = { execute: vi.fn<FailIngestionRunUseCase['execute']>() };
  const cgu = { execute: vi.fn() };
  let processor: EnvironmentalEvidencesProcessor;

  beforeEach(async () => {
    ingest.execute.mockResolvedValue(buildResult());
    company.execute.mockResolvedValue({
      ...buildResult(),
      cnpj: IBAMA_CNPJ,
      outcome: 'SUCCEEDED',
    });
    fail.execute.mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({
      providers: [
        EnvironmentalEvidencesProcessor,
        { provide: IngestIbamaDumpsUseCase, useValue: ingest },
        { provide: IngestIbamaCompanyUseCase, useValue: company },
        { provide: FailIngestionRunUseCase, useValue: fail },
        {
          provide: GetCguCompanyEvidencesUseCase,
          useValue: cgu,
        },
      ],
    }).compile();

    processor = moduleRef.get(EnvironmentalEvidencesProcessor);
  });

  it('atende a fila environmental-evidences com concorrência para os jobs por CNPJ não esperarem o lote', () => {
    expect(
      Reflect.getMetadata(
        'bullmq:processor_metadata',
        EnvironmentalEvidencesProcessor,
      ),
    ).toMatchObject({ name: QueueName.ENVIRONMENTAL_EVIDENCES });
    expect(
      Reflect.getMetadata(
        'bullmq:worker_metadata',
        EnvironmentalEvidencesProcessor,
      ) as { concurrency: number },
    ).toMatchObject({ concurrency: 3 });
  });

  it('executa o lote do job e devolve o resultado à fila', async () => {
    const result = buildResult();
    ingest.execute.mockResolvedValue(result);

    await expect(processor.process(buildJob())).resolves.toBe(result);

    expect(ingest.execute).toHaveBeenCalledWith({ jobId: JOB_ID });
    expect(fail.execute).not.toHaveBeenCalled();
  });

  it('aceita o job do agendador, publicado sem carga', async () => {
    await expect(
      processor.process(buildJob({ data: undefined })),
    ).resolves.toBeDefined();
    await expect(
      processor.process(buildJob({ data: null })),
    ).resolves.toBeDefined();
  });

  describe('job malformado: falha sem repetição e sem tocar a execução', () => {
    it('nome de job desconhecido', async () => {
      await expect(
        processor.process(buildJob({ name: 'outra-coisa' })),
      ).rejects.toBeInstanceOf(UnrecoverableError);

      expect(ingest.execute).not.toHaveBeenCalled();
      expect(fail.execute).not.toHaveBeenCalled();
    });

    it.each([
      ['texto', 'ingest'],
      ['número', 42],
      ['lista', []],
    ])('payload que é %s', async (_case, data) => {
      await expect(
        processor.process(buildJob({ data })),
      ).rejects.toBeInstanceOf(UnrecoverableError);

      expect(ingest.execute).not.toHaveBeenCalled();
    });

    it('job sem identificador', async () => {
      await expect(
        processor.process(buildJob({ id: undefined })),
      ).rejects.toBeInstanceOf(UnrecoverableError);

      expect(ingest.execute).not.toHaveBeenCalled();
    });
  });

  describe('falha no lote', () => {
    const failure = new IbamaDumpUnavailableError([
      { resource: 'AUTO_INFRACAO', reason: 'HTTP 503' },
    ]);

    it('devolve o mesmo erro, que não é "sem repetição", para a fila repetir', async () => {
      ingest.execute.mockRejectedValue(failure);

      const thrown = await processor
        .process(buildJob({ attemptsMade: 0 }))
        .catch((error: unknown) => error);

      expect(thrown).toBe(failure);
      expect(thrown).not.toBeInstanceOf(UnrecoverableError);
    });

    it.each([0, 1, 3])(
      'na tentativa %i (não é a última) a execução não é marcada FAILED',
      async (attemptsMade) => {
        ingest.execute.mockRejectedValue(failure);

        await expect(
          processor.process(buildJob({ attemptsMade })),
        ).rejects.toBe(failure);

        expect(fail.execute).not.toHaveBeenCalled();
      },
    );

    it('na última tentativa marca a execução FAILED, com o motivo, e repropaga o erro', async () => {
      ingest.execute.mockRejectedValue(failure);

      await expect(
        processor.process(buildJob({ attemptsMade: ATTEMPTS - 1 })),
      ).rejects.toBe(failure);

      expect(fail.execute).toHaveBeenCalledWith({
        sourceSlug: 'IBAMA',
        jobId: JOB_ID,
        errorMessage: failure.message,
      });
    });

    it('sem política de tentativas no job, a primeira falha já é a última', async () => {
      ingest.execute.mockRejectedValue(failure);

      await expect(
        processor.process(buildJob({ attempts: undefined })),
      ).rejects.toBe(failure);

      expect(fail.execute).toHaveBeenCalledOnce();
    });

    it('falha ao gravar o FAILED não mascara o erro original', async () => {
      ingest.execute.mockRejectedValue(failure);
      fail.execute.mockRejectedValue(new Error('banco fora'));

      await expect(
        processor.process(buildJob({ attemptsMade: ATTEMPTS - 1 })),
      ).rejects.toBe(failure);
    });

    it('um erro que não é Error também chega à execução como texto', async () => {
      ingest.execute.mockRejectedValue('quebrou');
      fail.execute.mockRejectedValue('banco fora');

      await expect(
        processor.process(buildJob({ attemptsMade: ATTEMPTS - 1 })),
      ).rejects.toBe('quebrou');

      expect(fail.execute).toHaveBeenCalledWith(
        expect.objectContaining({ errorMessage: 'quebrou' }),
      );
    });
  });

  describe('fonte desabilitada', () => {
    it('falha sem repetição já na primeira tentativa e marca a execução FAILED', async () => {
      const disabled = new IbamaSourceDisabledError();
      ingest.execute.mockRejectedValue(disabled);

      const thrown = await processor
        .process(buildJob({ attemptsMade: 0 }))
        .catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(UnrecoverableError);
      expect((thrown as Error).message).toBe(disabled.message);
      expect(fail.execute).toHaveBeenCalledWith({
        sourceSlug: 'IBAMA',
        jobId: JOB_ID,
        errorMessage: disabled.message,
      });
    });
  });
  describe('job avulso', () => {
    const job = (over: Partial<JobShape> = {}) =>
      buildJob({
        name: INGEST_IBAMA_COMPANY_JOB,
        data: { cnpj: IBAMA_CNPJ },
        ...over,
      });
    it('despacha pelo nome e passa somente CNPJ canonico e id', async () => {
      const result = {
        ...buildResult(),
        outcome: 'SUCCEEDED' as const,
        cnpj: IBAMA_CNPJ,
      };
      company.execute.mockResolvedValue(result);
      await expect(processor.process(job())).resolves.toBe(result);
      expect(company.execute).toHaveBeenCalledWith({
        jobId: JOB_ID,
        cnpj: IBAMA_CNPJ,
      });
      expect(ingest.execute).not.toHaveBeenCalled();
    });
    it.each([
      undefined,
      null,
      {},
      { cnpj: '11.222.333/0001-81' },
      { cnpj: 'invalid' },
    ])('recusa payload avulso invalido %o', async (data) => {
      await expect(processor.process(job({ data }))).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(company.execute).not.toHaveBeenCalled();
      expect(fail.execute).not.toHaveBeenCalled();
    });
    it('preserva retry e marca FAILED somente na ultima tentativa', async () => {
      const error = new Error(faker.lorem.word());
      company.execute.mockRejectedValue(error);
      await expect(processor.process(job())).rejects.toBe(error);
      expect(fail.execute).not.toHaveBeenCalled();
      await expect(
        processor.process(job({ attemptsMade: ATTEMPTS - 1 })),
      ).rejects.toBe(error);
      expect(fail.execute).toHaveBeenCalledWith({
        sourceSlug: 'IBAMA',
        jobId: JOB_ID,
        errorMessage: error.message,
      });
    });
    it('fonte desabilitada falha o avulso sem repeticao', async () => {
      company.execute.mockRejectedValue(new IbamaSourceDisabledError());
      await expect(processor.process(job())).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(fail.execute).toHaveBeenCalledOnce();
    });
  });
  describe('job CGU', () => {
    const job = (data: unknown = { cnpj: IBAMA_CNPJ }) =>
      buildJob({ name: FETCH_CGU_EVIDENCES_JOB, data });
    it('despacha uma coleta e devolve ACK serializavel, sem runs IBAMA', async () => {
      await expect(processor.process(job())).resolves.toEqual({
        status: 'COLLECTED',
      });
      expect(cgu.execute).toHaveBeenCalledWith({
        cnpj: IBAMA_CNPJ,
        context: { trigger: RequestTrigger.ON_DEMAND_JOB },
      });
      expect(ingest.execute).not.toHaveBeenCalled();
      expect(company.execute).not.toHaveBeenCalled();
      expect(fail.execute).not.toHaveBeenCalled();
    });
    it.each([
      {},
      null,
      { cnpj: 'invalido' },
      { cnpj: IBAMA_CNPJ, extra: true },
    ])('recusa payload %o sem repetir', async (data) => {
      await expect(processor.process(job(data))).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(cgu.execute).not.toHaveBeenCalled();
    });
    it('exige id', async () => {
      await expect(
        processor.process({ ...job(), id: undefined } as Job),
      ).rejects.toBeInstanceOf(UnrecoverableError);
    });
    it('erro CGU segue retry sem marcar ingestao IBAMA', async () => {
      const error = new Error('CGU indisponivel');
      cgu.execute.mockRejectedValueOnce(error);
      await expect(processor.process(job())).rejects.toBe(error);
      expect(fail.execute).not.toHaveBeenCalled();
    });
  });
});
