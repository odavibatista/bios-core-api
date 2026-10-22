import { Test } from '@nestjs/testing';
import { ResolveEvidenceSourceUseCase } from '@modules/data-sources/infra/usecases/evidence/resolve-evidence-source.usecase.js';
import { contentHash } from '@shared/domain/canonical-json.js';
import { evidenceSourceFactory } from '@test/factories/evidences/evidence.factory.js';
import {
  IBAMA_CNPJ,
  IBAMA_OTHER_CNPJ,
} from '@test/factories/ibama/ibama-dump.factory.js';
import { faker } from '@test/support/faker.js';
import { buildConfirmedEvidence } from '../../domain/confirmed-evidence.js';
import {
  EvidenceSourceNotFoundError,
  InvalidEvidenceError,
} from '../../domain/dtos/errors/evidence.errors.js';
import type { EvidenceBatchEntry } from '../../domain/dtos/providers/evidence-batch.dto.js';
import { RawEvidenceRepository } from '../../domain/dtos/repositories/raw-evidence.repository.js';
import { RecordEvidenceCollectionUseCase } from './record-evidence-collection.usecase.js';
import { RecordEvidenceEntriesUseCase } from './record-evidence-entries.usecase.js';

describe('RecordEvidenceEntriesUseCase', () => {
  const sources = { execute: vi.fn<ResolveEvidenceSourceUseCase['execute']>() };
  const raw = { save: vi.fn<RawEvidenceRepository['save']>() };
  const collection = {
    execute: vi.fn<RecordEvidenceCollectionUseCase['execute']>(),
  };
  const source = evidenceSourceFactory.build({ slug: 'IBAMA' });
  const collectedAt = faker.date.recent();
  const ingestionRunId = faker.database.mongodbObjectId();
  const rawId = faker.database.mongodbObjectId();
  let useCase: RecordEvidenceEntriesUseCase;
  const entry = (): EvidenceBatchEntry => ({
    cnpj: IBAMA_CNPJ,
    finding: {
      reference: faker.string.alphanumeric(12),
      summary: faker.lorem.sentence(),
    },
    raw: { valor: faker.number.int({ min: 100, max: 999 }) },
  });
  const input = (entries: EvidenceBatchEntry[] = []) => ({
    cnpj: IBAMA_CNPJ,
    sourceSlug: 'IBAMA',
    collectedAt,
    ingestionRunId,
    entries,
  });

  beforeEach(async () => {
    sources.execute.mockResolvedValue(source);
    raw.save.mockResolvedValue(rawId);
    collection.execute.mockResolvedValue({ saved: 1, removed: 2 });
    const moduleRef = await Test.createTestingModule({
      providers: [
        RecordEvidenceEntriesUseCase,
        { provide: ResolveEvidenceSourceUseCase, useValue: sources },
        { provide: RawEvidenceRepository, useValue: raw },
        { provide: RecordEvidenceCollectionUseCase, useValue: collection },
      ],
    }).compile();
    useCase = moduleRef.get(RecordEvidenceEntriesUseCase);
  });

  it('liga bruto, execucao e retrato ao mesmo CNPJ usando o hash do lote', async () => {
    const value = entry();
    const evidence = buildConfirmedEvidence(value.finding, {
      cnpj: IBAMA_CNPJ,
      source,
      collectedAt,
      validUntil: collectedAt,
    });
    await expect(useCase.execute(input([value]))).resolves.toEqual({
      saved: 1,
      removed: 2,
    });
    expect(raw.save).toHaveBeenCalledWith({
      dataSourceId: source.id,
      ingestionRunId,
      cnpj: IBAMA_CNPJ,
      externalReference: value.finding.reference,
      payload: value.raw,
      payloadHash: contentHash({ key: evidence.key, raw: value.raw }),
      collectedAt,
    });
    expect(collection.execute).toHaveBeenCalledWith({
      cnpj: IBAMA_CNPJ,
      sourceSlug: 'IBAMA',
      collectedAt,
      result: {
        status: 'COLLECTED',
        findings: [{ ...value.finding, rawEvidenceId: rawId }],
      },
    });
  });

  it('ausencia confirmada usa findings vazios e nao inventa um bruto', async () => {
    await useCase.execute(input());
    expect(raw.save).not.toHaveBeenCalled();
    expect(collection.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        result: { status: 'COLLECTED', findings: [] },
      }),
    );
  });

  it('coleta fora de job grava bruto sem execucao de ingestao', async () => {
    await useCase.execute({ ...input([entry()]), ingestionRunId: undefined });
    expect(raw.save).toHaveBeenCalledWith(
      expect.objectContaining({ ingestionRunId: null }),
    );
  });

  it.each(['invalid', '11.222.333/0001-81'])(
    'recusa CNPJ nao canonico %s antes de escrever',
    async (cnpj) => {
      await expect(
        useCase.execute({ ...input(), cnpj }),
      ).rejects.toBeInstanceOf(InvalidEvidenceError);
      expect(sources.execute).not.toHaveBeenCalled();
      expect(raw.save).not.toHaveBeenCalled();
      expect(collection.execute).not.toHaveBeenCalled();
    },
  );

  it('recusa entradas de outra empresa mesmo misturadas com entradas validas', async () => {
    await expect(
      useCase.execute(input([entry(), { ...entry(), cnpj: IBAMA_OTHER_CNPJ }])),
    ).rejects.toBeInstanceOf(InvalidEvidenceError);
    expect(raw.save).not.toHaveBeenCalled();
    expect(collection.execute).not.toHaveBeenCalled();
  });

  it('valida todas as referencias antes de persistir qualquer entrada', async () => {
    await expect(
      useCase.execute(
        input([entry(), { ...entry(), finding: { reference: ' ' } }]),
      ),
    ).rejects.toBeInstanceOf(InvalidEvidenceError);
    expect(raw.save).not.toHaveBeenCalled();
    expect(collection.execute).not.toHaveBeenCalled();
  });

  it('recusa fonte ausente', async () => {
    sources.execute.mockResolvedValue(null);
    await expect(useCase.execute(input([entry()]))).rejects.toBeInstanceOf(
      EvidenceSourceNotFoundError,
    );
    expect(raw.save).not.toHaveBeenCalled();
  });

  it('falha ao gravar bruto nao substitui o retrato', async () => {
    const error = new Error(faker.lorem.word());
    raw.save.mockRejectedValue(error);
    await expect(useCase.execute(input([entry()]))).rejects.toBe(error);
    expect(collection.execute).not.toHaveBeenCalled();
  });
});
