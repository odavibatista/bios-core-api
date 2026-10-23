import { RequestTrigger } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { type Job, UnrecoverableError } from 'bullmq';
import { GetCguCompanyEvidencesUseCase } from '@modules/cgu/infra/usecases/get-cgu-company-evidences.usecase.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { IBAMA_CNPJ } from '@test/factories/ibama/ibama-dump.factory.js';
import { FETCH_CGU_EVIDENCES_JOB } from '../../domain/cgu-job.dto.js';
import { EnvironmentalEvidencesProcessor } from './environmental-evidences.processor.js';

function buildJob(over: Partial<Job<unknown>> = {}): Job<unknown> {
  return {
    name: FETCH_CGU_EVIDENCES_JOB,
    data: { cnpj: IBAMA_CNPJ },
    id: 'job-1',
    attemptsMade: 0,
    opts: { attempts: 5 },
    ...over,
  } as Job<unknown>;
}

describe('EnvironmentalEvidencesProcessor', () => {
  const cgu = { execute: vi.fn() };
  let processor: EnvironmentalEvidencesProcessor;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        EnvironmentalEvidencesProcessor,
        { provide: GetCguCompanyEvidencesUseCase, useValue: cgu },
      ],
    }).compile();
    processor = moduleRef.get(EnvironmentalEvidencesProcessor);
  });

  it('atende só a fila ambiental, com concorrência 3 para a CGU', () => {
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

  it('despacha uma coleta e devolve ACK serializável', async () => {
    await expect(processor.process(buildJob())).resolves.toEqual({
      status: 'COLLECTED',
    });
    expect(cgu.execute).toHaveBeenCalledWith({
      cnpj: IBAMA_CNPJ,
      context: { trigger: RequestTrigger.ON_DEMAND_JOB },
    });
  });

  it.each([{}, null, { cnpj: 'invalido' }, { cnpj: IBAMA_CNPJ, extra: true }])(
    'recusa payload %o sem repetir',
    async (data) => {
      await expect(
        processor.process(buildJob({ data })),
      ).rejects.toBeInstanceOf(UnrecoverableError);
      expect(cgu.execute).not.toHaveBeenCalled();
    },
  );

  it('exige id', async () => {
    await expect(
      processor.process(buildJob({ id: undefined })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it.each(['ingest-ibama-dumps', 'ingest-ibama-company', 'outra-coisa'])(
    'não aceita o job %s: o IBAMA tem fila própria',
    async (name) => {
      await expect(
        processor.process(buildJob({ name })),
      ).rejects.toBeInstanceOf(UnrecoverableError);
      expect(cgu.execute).not.toHaveBeenCalled();
    },
  );

  it('erro da CGU segue para a fila repetir', async () => {
    const error = new Error('CGU indisponivel');
    cgu.execute.mockRejectedValueOnce(error);
    await expect(processor.process(buildJob())).rejects.toBe(error);
  });
});
