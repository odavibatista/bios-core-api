import { Test } from '@nestjs/testing';
import { RequestOutcome, RequestTrigger } from '@prisma/client';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { faker } from '@test/support/faker.js';
import { PrismaDataSourceRequestLogRepository } from './prisma-data-source-request-log.repository.js';

describe('PrismaDataSourceRequestLogRepository', () => {
  const create = vi.fn();
  let repository: PrismaDataSourceRequestLogRepository;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaDataSourceRequestLogRepository,
        {
          provide: PrismaService,
          useValue: { dataSourceRequestLog: { create } },
        },
      ],
    }).compile();

    repository = moduleRef.get(PrismaDataSourceRequestLogRepository);
  });

  it('grava todos os campos da chamada', async () => {
    const entry = {
      dataSourceId: faker.database.mongodbObjectId(),
      ingestionRunId: faker.database.mongodbObjectId(),
      cnpj: '11222333000181',
      trigger: RequestTrigger.SCHEDULED_JOB,
      outcome: RequestOutcome.FAILURE,
      httpStatus: 503,
      durationMs: 321,
      errorMessage: 'HTTP 503',
    };

    await repository.record(entry);

    expect(create).toHaveBeenCalledWith({
      data: {
        data_source_id: entry.dataSourceId,
        ingestion_run_id: entry.ingestionRunId,
        cnpj: entry.cnpj,
        trigger: entry.trigger,
        outcome: entry.outcome,
        http_status: 503,
        duration_ms: 321,
        error_message: 'HTTP 503',
      },
    });
  });

  it('deixa de fora os campos opcionais ausentes', async () => {
    await repository.record({
      dataSourceId: faker.database.mongodbObjectId(),
      trigger: RequestTrigger.USER_QUERY,
      outcome: RequestOutcome.SUCCESS,
      durationMs: 10,
    });

    const [{ data }] = create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data.ingestion_run_id).toBeUndefined();
    expect(data.cnpj).toBeUndefined();
    expect(data.http_status).toBeUndefined();
    expect(data.error_message).toBeUndefined();
  });

  it('propaga a falha do banco', async () => {
    create.mockRejectedValue(new Error('banco fora'));

    await expect(
      repository.record({
        dataSourceId: faker.database.mongodbObjectId(),
        trigger: RequestTrigger.USER_QUERY,
        outcome: RequestOutcome.SUCCESS,
        durationMs: 1,
      }),
    ).rejects.toThrow('banco fora');
  });
});
