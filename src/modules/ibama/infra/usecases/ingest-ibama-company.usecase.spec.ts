import { Test } from '@nestjs/testing';
import { IngestionRunStatus, RequestTrigger } from '@prisma/client';
import { SourceOutcome } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { OpenIngestionRunUseCase } from '@modules/data-sources/infra/usecases/ingestion/open-ingestion-run.usecase.js';
import { FinishIngestionRunUseCase } from '@modules/data-sources/infra/usecases/ingestion/finish-ingestion-run.usecase.js';
import { RecordEvidenceEntriesUseCase } from '@modules/evidences/infra/usecases/record-evidence-entries.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { InvalidEvidenceError } from '@modules/evidences/domain/dtos/errors/evidence.errors.js';
import { ingestionRunFactory } from '@test/factories/data-sources/ingestion-run.factory.js';
import {
  IBAMA_CNPJ,
  IBAMA_OTHER_CNPJ,
  ibamaRecordFactory,
} from '@test/factories/ibama/ibama-dump.factory.js';
import {
  buildFakeDump,
  buildReadStats,
  type FakeIbamaDump,
} from '@test/factories/ibama/ibama-fake-dump.factory.js';
import { faker } from '@test/support/faker.js';
import {
  IbamaDumpUnavailableError,
  IbamaSourceDisabledError,
} from '../../domain/dtos/errors/ibama-ingestion.errors.js';
import {
  IbamaDumpFormatError,
  type IbamaRecord,
} from '../../domain/dtos/providers/ibama-dump.dto.js';
import { combineDumpChecksums } from '../../domain/ibama-dump-checksum.js';
import { toEvidenceEntry } from '../../domain/ibama-evidence.mapper.js';
import { IbamaDiscardReason } from '../../domain/ibama-document.js';
import { IbamaResource } from '../../domain/ibama-resource.js';
import { IbamaDumpLease } from '../providers/ibama-dump-lease.js';
import { IbamaDataSource } from '../providers/ibama.data-source.js';
import { IngestIbamaCompanyUseCase } from './ingest-ibama-company.usecase.js';

describe('IngestIbamaCompanyUseCase', () => {
  const source = { download: vi.fn<IbamaDataSource['download']>() };
  const open = { execute: vi.fn<OpenIngestionRunUseCase['execute']>() };
  const finish = { execute: vi.fn<FinishIngestionRunUseCase['execute']>() };
  const entries = { execute: vi.fn<RecordEvidenceEntriesUseCase['execute']>() };
  const collection = {
    execute: vi.fn<RecordEvidenceCollectionUseCase['execute']>(),
  };
  const run = ingestionRunFactory.build({ status: IngestionRunStatus.RUNNING });
  const input = { cnpj: IBAMA_CNPJ, jobId: faker.string.uuid() };
  let useCase: IngestIbamaCompanyUseCase;
  let lease: IbamaDumpLease;
  let autos: FakeIbamaDump;
  let embargos: FakeIbamaDump;
  function records(dump: FakeIbamaDump, values: IbamaRecord[]) {
    dump.stats = buildReadStats({ rows: values.length, kept: values.length });
    dump.records.mockImplementation(async function* () {
      await Promise.resolve();
      yield* values;
    });
  }
  beforeEach(async () => {
    autos = buildFakeDump(IbamaResource.AUTO_INFRACAO, {
      stats: buildReadStats({ rows: 0 }),
    });
    embargos = buildFakeDump(IbamaResource.TERMO_EMBARGO, {
      stats: buildReadStats({ rows: 0 }),
    });
    source.download.mockImplementation((resource) =>
      Promise.resolve({
        status: 'FOUND',
        data: resource === IbamaResource.AUTO_INFRACAO ? autos : embargos,
      }),
    );
    open.execute.mockResolvedValue(run);
    finish.execute.mockResolvedValue();
    entries.execute.mockResolvedValue({ saved: 1, removed: 2 });
    collection.execute.mockResolvedValue({ saved: 1, removed: 0 });
    const moduleRef = await Test.createTestingModule({
      providers: [
        IngestIbamaCompanyUseCase,
        IbamaDumpLease,
        { provide: IbamaDataSource, useValue: source },
        { provide: OpenIngestionRunUseCase, useValue: open },
        { provide: FinishIngestionRunUseCase, useValue: finish },
        { provide: RecordEvidenceEntriesUseCase, useValue: entries },
        { provide: RecordEvidenceCollectionUseCase, useValue: collection },
      ],
    }).compile();
    useCase = moduleRef.get(IngestIbamaCompanyUseCase);
    lease = moduleRef.get(IbamaDumpLease);
  });
  afterEach(async () => {
    await lease.clear();
  });
  it('abre ON_DEMAND e liga os dois downloads a execucao, filtrando outras empresas e anulados', async () => {
    const auto = ibamaRecordFactory.build();
    const embargo = ibamaRecordFactory.build({
      resource: IbamaResource.TERMO_EMBARGO,
    });
    const annulled = ibamaRecordFactory.build({
      payload: { SIT_CANCELADO: 'S' },
    });
    records(autos, [
      auto,
      ibamaRecordFactory.build({ cnpj: IBAMA_OTHER_CNPJ }),
      annulled,
    ]);
    records(embargos, [embargo]);
    autos.stats.rows += 1;
    autos.stats.discarded[IbamaDiscardReason.PESSOA_FISICA] = 1;
    entries.execute.mockResolvedValue({ saved: 2, removed: 2 });
    const result = await useCase.execute(input);
    expect(open.execute).toHaveBeenCalledWith({
      ...input,
      sourceSlug: 'IBAMA',
      startedAt: expect.any(Date),
    });
    for (const resource of [
      IbamaResource.AUTO_INFRACAO,
      IbamaResource.TERMO_EMBARGO,
    ]) {
      expect(source.download).toHaveBeenCalledWith(resource, {
        trigger: RequestTrigger.ON_DEMAND_JOB,
        ingestionRunId: run.id,
      });
    }
    expect(entries.execute).toHaveBeenCalledWith({
      cnpj: IBAMA_CNPJ,
      sourceSlug: 'IBAMA',
      ingestionRunId: run.id,
      collectedAt: expect.any(Date),
      entries: [toEvidenceEntry(auto), toEvidenceEntry(embargo)],
    });
    expect(finish.execute).toHaveBeenCalledWith({
      runId: run.id,
      status: IngestionRunStatus.SUCCEEDED,
      dumpChecksum: combineDumpChecksums([autos, embargos]),
      recordsRead: 5,
      recordsUpserted: 2,
      recordsDiscarded: 3,
    });
    expect(result).toMatchObject({
      outcome: 'SUCCEEDED',
      cnpj: IBAMA_CNPJ,
      ingestionRunId: run.id,
      removed: 2,
    });
    expect(autos.dispose).not.toHaveBeenCalled();
    await lease.clear();
    expect(autos.dispose).toHaveBeenCalledOnce();
    expect(embargos.dispose).toHaveBeenCalledOnce();
    expect(collection.execute).not.toHaveBeenCalled();
  });
  it('ausencia so e confirmada depois dos dois recursos completos', async () => {
    const calls: string[] = [];
    embargos.records.mockImplementation(async function* () {
      calls.push('leu segundo');
      await Promise.resolve();
      yield* [];
    });
    entries.execute.mockImplementation(() => {
      calls.push('grava');
      return Promise.resolve({ saved: 1, removed: 0 });
    });
    await useCase.execute(input);
    expect(calls).toEqual(['leu segundo', 'grava']);
    expect(entries.execute).toHaveBeenCalledWith(
      expect.objectContaining({ entries: [] }),
    );
  });
  it.each([
    [
      'UNAVAILABLE',
      {
        status: 'UNAVAILABLE',
        reason: SourceOutcome.FAILURE,
        message: 'HTTP 503',
      },
      'HTTP 503',
    ],
    [
      'sem mensagem',
      { status: 'UNAVAILABLE', reason: SourceOutcome.RATE_LIMITED },
      'RATE_LIMITED',
    ],
    ['NOT_FOUND', { status: 'NOT_FOUND' }, 'dump não encontrado'],
  ] as const)(
    'recurso %s falha, preserva retrato e descarta o temporario baixado',
    async (_label, result, message) => {
      source.download
        .mockResolvedValueOnce(result)
        .mockResolvedValueOnce({ status: 'FOUND', data: embargos });
      await expect(useCase.execute(input)).rejects.toThrow(message);
      expect(source.download).toHaveBeenCalledTimes(2);
      expect(entries.execute).not.toHaveBeenCalled();
      expect(finish.execute).not.toHaveBeenCalled();
      expect(collection.execute).toHaveBeenCalledWith(
        expect.objectContaining({ result: { status: 'UNAVAILABLE' } }),
      );
      expect(embargos.dispose).toHaveBeenCalledOnce();
    },
  );
  it('fonte desabilitada interrompe sem tentar segundo download', async () => {
    source.download.mockResolvedValue({
      status: 'UNAVAILABLE',
      reason: SourceOutcome.DISABLED,
    });
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(
      IbamaSourceDisabledError,
    );
    expect(source.download).toHaveBeenCalledOnce();
    expect(entries.execute).not.toHaveBeenCalled();
  });
  it('segundo dump malformado nao grava nem mesmo os achados do primeiro', async () => {
    records(autos, [ibamaRecordFactory.build()]);
    const error = new IbamaDumpFormatError(faker.lorem.word());
    embargos.records.mockImplementation(async function* () {
      await Promise.resolve();
      throw error;
      yield* [];
    });
    await expect(useCase.execute(input)).rejects.toBe(error);
    expect(entries.execute).not.toHaveBeenCalled();
    expect(finish.execute).not.toHaveBeenCalled();
    await lease.clear();
    expect(autos.dispose).toHaveBeenCalledOnce();
    expect(embargos.dispose).toHaveBeenCalledOnce();
  });
  it('falha ao preservar UNKNOWN nao mascara falha original da fonte', async () => {
    source.download.mockResolvedValue({
      status: 'UNAVAILABLE',
      reason: SourceOutcome.TIMEOUT,
    });
    collection.execute.mockRejectedValue(new Error(faker.lorem.word()));
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(
      IbamaDumpUnavailableError,
    );
  });
  it('falha ao persistir nao registra sucesso', async () => {
    const error = new Error(faker.lorem.word());
    entries.execute.mockRejectedValue(error);
    await expect(useCase.execute(input)).rejects.toBe(error);
    expect(finish.execute).not.toHaveBeenCalled();
    await lease.clear();
    expect(autos.dispose).toHaveBeenCalledOnce();
  });
  it('falha de dispose nao impede limpeza do outro recurso nem muda sucesso', async () => {
    autos.dispose.mockRejectedValue(new Error(faker.lorem.word()));
    await expect(useCase.execute(input)).resolves.toMatchObject({
      outcome: 'SUCCEEDED',
    });
    await lease.clear();
    expect(embargos.dispose).toHaveBeenCalledOnce();
  });
  it('CNPJs distintos em sequencia compartilham um unico download dos dois dumps', async () => {
    records(autos, [ibamaRecordFactory.build()]);
    records(embargos, []);
    await useCase.execute(input);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await useCase.execute({
      jobId: faker.string.uuid(),
      cnpj: IBAMA_OTHER_CNPJ,
    });
    expect(source.download).toHaveBeenCalledTimes(2);
    expect(second).toMatchObject({
      outcome: 'SUCCEEDED',
      cnpj: IBAMA_OTHER_CNPJ,
    });
    expect(entries.execute).toHaveBeenCalledTimes(2);
    expect(entries.execute.mock.calls[1][0]).toMatchObject({
      cnpj: IBAMA_OTHER_CNPJ,
      entries: [],
    });
    expect(entries.execute.mock.calls[1][0].collectedAt).toEqual(
      entries.execute.mock.calls[0][0].collectedAt,
    );
    expect(lease.stats).toMatchObject({ downloads: 1, reuses: 1 });
  });
  it('tres avulsos simultaneos fazem um download so e leem os dumps um de cada vez', async () => {
    const cnpjs = [IBAMA_CNPJ, IBAMA_OTHER_CNPJ, '33000167000101'];
    let readers = 0;
    let peak = 0;
    for (const dump of [autos, embargos])
      dump.records.mockImplementation(async function* () {
        readers += 1;
        peak = Math.max(peak, readers);
        await new Promise((resolve) => setTimeout(resolve, 5));
        readers -= 1;
        yield* [];
      });
    await Promise.all(
      cnpjs.map((cnpj) =>
        useCase.execute({ jobId: faker.string.uuid(), cnpj }),
      ),
    );
    expect(source.download).toHaveBeenCalledTimes(2);
    expect(lease.stats).toMatchObject({ downloads: 1, peakDownloads: 1 });
    expect(peak).toBe(1);
    expect(entries.execute).toHaveBeenCalledTimes(3);
  });
  it('falha ao abrir execucao nao baixa arquivos', async () => {
    const error = new Error(faker.lorem.word());
    open.execute.mockRejectedValue(error);
    await expect(useCase.execute(input)).rejects.toBe(error);
    expect(source.download).not.toHaveBeenCalled();
  });
  it('CNPJ invalido nao abre execucao', async () => {
    await expect(
      useCase.execute({ ...input, cnpj: 'invalid' }),
    ).rejects.toBeInstanceOf(InvalidEvidenceError);
    expect(open.execute).not.toHaveBeenCalled();
  });
});
