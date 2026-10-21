import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { IBAMA_CNPJ } from '@test/factories/ibama/ibama-dump.factory.js';
import { faker } from '@test/support/faker.js';
import type { RawEvidenceToSave } from '../../../domain/dtos/repositories/raw-evidence.repository.js';
import { PrismaRawEvidenceRepository } from './prisma-raw-evidence.repository.js';

describe('PrismaRawEvidenceRepository', () => {
  const upsert = vi.fn();
  let repository: PrismaRawEvidenceRepository;

  const raw: RawEvidenceToSave = {
    dataSourceId: faker.database.mongodbObjectId(),
    ingestionRunId: faker.database.mongodbObjectId(),
    cnpj: IBAMA_CNPJ,
    externalReference: '1092-A',
    payload: { resource: 'AUTO_INFRACAO', payload: { UF: 'PA' } },
    payloadHash: faker.string.hexadecimal({
      length: 64,
      prefix: '',
      casing: 'lower',
    }),
    collectedAt: faker.date.recent(),
  };

  function uniqueViolation() {
    return new Prisma.PrismaClientKnownRequestError('duplicada', {
      code: 'P2002',
      clientVersion: 'test',
    });
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaRawEvidenceRepository,
        {
          provide: PrismaService,
          useValue: { evidenceRaw: { upsert } },
        },
      ],
    }).compile();

    repository = moduleRef.get(PrismaRawEvidenceRepository);
  });

  it('procura pela fonte e pelo resumo do conteúdo, e só cria quando não existe', async () => {
    upsert.mockResolvedValue({ id_evidence_raw: 'raw-1' });

    await expect(repository.save(raw)).resolves.toBe('raw-1');

    expect(upsert).toHaveBeenCalledWith({
      where: {
        data_source_id_payload_hash: {
          data_source_id: raw.dataSourceId,
          payload_hash: raw.payloadHash,
        },
      },
      create: {
        data_source_id: raw.dataSourceId,
        ingestion_run_id: raw.ingestionRunId,
        cnpj: IBAMA_CNPJ,
        external_reference: '1092-A',
        payload: raw.payload,
        payload_hash: raw.payloadHash,
        collected_at: raw.collectedAt,
      },
      update: {},
      select: { id_evidence_raw: true },
    });
  });

  it('o registro que já existe não é alterado: a data e a execução da primeira coleta ficam', async () => {
    upsert.mockResolvedValue({ id_evidence_raw: 'raw-1' });

    await repository.save(raw);

    const [{ update }] = upsert.mock.calls[0] as [{ update: object }];
    expect(update).toEqual({});
  });

  it('registro sem execução de ingestão', async () => {
    upsert.mockResolvedValue({ id_evidence_raw: 'raw-1' });

    await repository.save({ ...raw, ingestionRunId: null });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ ingestion_run_id: null }),
      }),
    );
  });

  it('se a criação disputada perde para outra gravação (índice único), tenta de novo', async () => {
    upsert
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValue({ id_evidence_raw: 'raw-2' });

    await expect(repository.save(raw)).resolves.toBe('raw-2');

    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('não esconde a violação que se repete', async () => {
    upsert.mockRejectedValue(uniqueViolation());

    await expect(repository.save(raw)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('propaga qualquer outra falha, sem repetir', async () => {
    upsert.mockRejectedValue(new Error('banco fora'));

    await expect(repository.save(raw)).rejects.toThrow('banco fora');
    expect(upsert).toHaveBeenCalledOnce();
  });
});
