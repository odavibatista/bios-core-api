import { Test } from '@nestjs/testing';
import { EvidenceState } from '@prisma/client';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import { FindLastConfirmedBatchUseCase } from '@modules/data-sources/infra/usecases/ingestion/find-last-confirmed-batch.usecase.js';
import type { StoredEvidence } from '@modules/evidences/domain/dtos/repositories/evidence.repository.js';
import { InvalidEvidenceError } from '@modules/evidences/domain/dtos/errors/evidence.errors.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { DependencyUnavailableException } from '@shared/domain/errors/dependency-unavailable.exception.js';
import { QueueProvider } from '@shared/domain/providers/queue.provider.js';
import { ingestionRunFactory } from '@test/factories/data-sources/ingestion-run.factory.js';
import { storedEvidenceFactory } from '@test/factories/evidences/evidence.factory.js';
import {
  IBAMA_CNPJ,
  IBAMA_CNPJ_MASKED,
} from '@test/factories/ibama/ibama-dump.factory.js';
import { faker } from '@test/support/faker.js';
import {
  ibamaCompanyJobId,
  INGEST_IBAMA_COMPANY_JOB,
} from '../../domain/dtos/providers/ibama-company-job.dto.js';
import { GetIbamaCompanyEvidencesUseCase } from './get-ibama-company-evidences.usecase.js';

describe('GetIbamaCompanyEvidencesUseCase', () => {
  const list = { execute: vi.fn<ListCompanyEvidencesUseCase['execute']>() };
  const last = { execute: vi.fn<FindLastConfirmedBatchUseCase['execute']>() };
  const ttl = { execute: vi.fn<ResolveSourceCacheTtlUseCase['execute']>() };
  const record = {
    execute: vi.fn<RecordEvidenceCollectionUseCase['execute']>(),
  };
  const queue = { enqueue: vi.fn<QueueProvider['enqueue']>() };
  const now = faker.date.recent();
  const pending = storedEvidenceFactory.build({
    cnpj: IBAMA_CNPJ,
    state: EvidenceState.UNKNOWN,
    validUntil: new Date(now.getTime() + 900_000),
  });
  let useCase: GetIbamaCompanyEvidencesUseCase;
  function reads(...values: StoredEvidence[][]) {
    list.execute.mockReset().mockResolvedValue([pending]);
    for (const value of values) list.execute.mockResolvedValueOnce(value);
  }
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    reads([]);
    last.execute.mockResolvedValue(null);
    ttl.execute.mockResolvedValue(172800);
    record.execute.mockResolvedValue({ saved: 1, removed: 0 });
    queue.enqueue.mockResolvedValue();
    const moduleRef = await Test.createTestingModule({
      providers: [
        GetIbamaCompanyEvidencesUseCase,
        { provide: ListCompanyEvidencesUseCase, useValue: list },
        { provide: FindLastConfirmedBatchUseCase, useValue: last },
        { provide: ResolveSourceCacheTtlUseCase, useValue: ttl },
        { provide: RecordEvidenceCollectionUseCase, useValue: record },
        { provide: QueueProvider, useValue: queue },
      ],
    }).compile();
    useCase = moduleRef.get(GetIbamaCompanyEvidencesUseCase);
  });
  afterEach(() => vi.useRealTimers());

  it.each([EvidenceState.CONFIRMED, EvidenceState.NOT_FOUND])(
    'retorna %s valido sem fila nem lote',
    async (state) => {
      const evidence = { ...pending, state };
      reads([evidence]);
      await expect(useCase.execute(IBAMA_CNPJ)).resolves.toEqual([evidence]);
      expect(last.execute).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    },
  );
  it('normaliza CNPJ e registra UNKNOWN antes da publicacao sem esperar resultado', async () => {
    await expect(useCase.execute(IBAMA_CNPJ_MASKED)).resolves.toEqual([
      pending,
    ]);
    expect(list.execute).toHaveBeenCalledWith(IBAMA_CNPJ);
    expect(record.execute).toHaveBeenCalledWith({
      cnpj: IBAMA_CNPJ,
      sourceSlug: 'IBAMA',
      collectedAt: now,
      result: { status: 'UNAVAILABLE' },
    });
    expect(queue.enqueue).toHaveBeenCalledWith(
      QueueName.IBAMA_INGESTION,
      INGEST_IBAMA_COMPANY_JOB,
      { cnpj: IBAMA_CNPJ },
      { jobId: ibamaCompanyJobId(IBAMA_CNPJ, now) },
    );
    expect(record.execute.mock.invocationCallOrder[0]).toBeLessThan(
      queue.enqueue.mock.invocationCallOrder[0],
    );
    expect(record.execute).toHaveBeenCalledOnce();
  });
  it('ignora outras fontes e nao as devolve como IBAMA', async () => {
    reads([storedEvidenceFactory.build({ sourceSlug: 'CGU_CEIS' })]);
    await expect(useCase.execute(IBAMA_CNPJ)).resolves.toEqual([pending]);
    expect(queue.enqueue).toHaveBeenCalledOnce();
  });
  it.each(['SUCCEEDED', 'SKIPPED_UNCHANGED'] as const)(
    'ausencia em lote %s valido confirma NOT_FOUND com a data original',
    async (status) => {
      const startedAt = new Date(now.getTime() - 86_400_000);
      const batch = ingestionRunFactory.build({
        status,
        startedAt,
        finishedAt: new Date(startedAt.getTime() + 1000),
      });
      last.execute.mockResolvedValue(batch);
      const absent = { ...pending, state: EvidenceState.NOT_FOUND };
      reads([], [absent]);
      await expect(useCase.execute(IBAMA_CNPJ)).resolves.toEqual([absent]);
      expect(record.execute).toHaveBeenCalledWith({
        cnpj: IBAMA_CNPJ,
        sourceSlug: 'IBAMA',
        collectedAt: startedAt,
        result: { status: 'COLLECTED', findings: [] },
      });
      expect(queue.enqueue).not.toHaveBeenCalled();
      expect(ttl.execute).toHaveBeenCalledWith('IBAMA');
    },
  );
  it('lote valido substitui UNKNOWN ainda na janela de espera', async () => {
    reads([pending], [{ ...pending, state: EvidenceState.NOT_FOUND }]);
    last.execute.mockResolvedValue(
      ingestionRunFactory.build({ startedAt: now, finishedAt: now }),
    );
    await useCase.execute(IBAMA_CNPJ);
    expect(record.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        result: { status: 'COLLECTED', findings: [] },
      }),
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
  it.each([
    { startedAt: new Date(now.getTime() - 172800_000), finishedAt: now },
    { startedAt: null, finishedAt: now },
    { startedAt: now, finishedAt: null },
  ])('lote vencido ou incompleto nao confirma ausencia %o', async (dates) => {
    last.execute.mockResolvedValue(ingestionRunFactory.build(dates));
    await useCase.execute(IBAMA_CNPJ);
    expect(queue.enqueue).toHaveBeenCalledOnce();
    expect(record.execute).toHaveBeenCalledWith(
      expect.objectContaining({ result: { status: 'UNAVAILABLE' } }),
    );
  });
  it('UNKNOWN valido evita repetir a publicacao, mas consulta lote mais recente', async () => {
    reads([pending]);
    await expect(useCase.execute(IBAMA_CNPJ)).resolves.toEqual([pending]);
    expect(last.execute).toHaveBeenCalledWith('IBAMA');
    expect(record.execute).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
  it('UNKNOWN expirado publica nova tentativa', async () => {
    reads([{ ...pending, validUntil: now }]);
    await useCase.execute(IBAMA_CNPJ);
    expect(queue.enqueue).toHaveBeenCalledOnce();
  });
  it.each([EvidenceState.OUTDATED, EvidenceState.CONFIRMED])(
    'preserva resposta vencida %s enquanto publica atualizacao',
    async (state) => {
      const old = {
        ...pending,
        state,
        validUntil: new Date(now.getTime() - 1),
      };
      reads([old], [old]);
      last.execute.mockResolvedValue(
        ingestionRunFactory.build({ startedAt: now, finishedAt: now }),
      );
      await expect(useCase.execute(IBAMA_CNPJ)).resolves.toEqual([old]);
      expect(queue.enqueue).toHaveBeenCalledOnce();
      expect(record.execute).toHaveBeenCalledWith(
        expect.objectContaining({ result: { status: 'UNAVAILABLE' } }),
      );
    },
  );
  it('fila indisponivel devolve UNKNOWN', async () => {
    queue.enqueue.mockRejectedValue(
      new DependencyUnavailableException('redis'),
    );
    await expect(useCase.execute(IBAMA_CNPJ)).resolves.toEqual([pending]);
  });
  it('erro inesperado na publicacao propaga', async () => {
    const error = new Error(faker.lorem.word());
    queue.enqueue.mockRejectedValue(error);
    await expect(useCase.execute(IBAMA_CNPJ)).rejects.toBe(error);
  });
  it('CNPJ invalido nao consulta nem publica', async () => {
    await expect(useCase.execute('invalid')).rejects.toBeInstanceOf(
      InvalidEvidenceError,
    );
    expect(list.execute).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
