import { Test } from '@nestjs/testing';
import { EvidenceCategory } from '@prisma/client';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import { ResolveEvidenceSourceUseCase } from '@modules/data-sources/infra/usecases/evidence/resolve-evidence-source.usecase.js';
import { evidenceSourceFactory } from '@test/factories/evidences/evidence.factory.js';
import { IBAMA_CNPJ } from '@test/factories/ibama/ibama-dump.factory.js';
import { faker } from '@test/support/faker.js';
import { EvidenceSourceNotFoundError } from '../../domain/dtos/errors/evidence.errors.js';
import { EvidenceRepository } from '../../domain/dtos/repositories/evidence.repository.js';
import { RawEvidenceRepository } from '../../domain/dtos/repositories/raw-evidence.repository.js';
import { OpenEvidenceBatchUseCase } from './open-evidence-batch.usecase.js';

describe('OpenEvidenceBatchUseCase', () => {
  const evidenceRepository = {
    save: vi.fn<EvidenceRepository['save']>(),
    deleteNotCollectedSince:
      vi.fn<EvidenceRepository['deleteNotCollectedSince']>(),
  };
  const rawEvidenceRepository = {
    save: vi.fn<RawEvidenceRepository['save']>(),
  };
  const resolveEvidenceSource = {
    execute: vi.fn<ResolveEvidenceSourceUseCase['execute']>(),
  };
  const resolveSourceCacheTtl = {
    execute: vi.fn<ResolveSourceCacheTtlUseCase['execute']>(),
  };
  let useCase: OpenEvidenceBatchUseCase;

  const source = evidenceSourceFactory.build({
    slug: 'IBAMA',
    category: EvidenceCategory.INFRACAO_AMBIENTAL,
  });
  const collectedAt = faker.date.recent();
  const TTL_SECONDS = 2 * 86_400;

  beforeEach(async () => {
    evidenceRepository.save.mockResolvedValue(undefined);
    evidenceRepository.deleteNotCollectedSince.mockResolvedValue(0);
    rawEvidenceRepository.save.mockResolvedValue('raw-1');
    resolveEvidenceSource.execute.mockResolvedValue(source);
    resolveSourceCacheTtl.execute.mockResolvedValue(TTL_SECONDS);

    const moduleRef = await Test.createTestingModule({
      providers: [
        OpenEvidenceBatchUseCase,
        { provide: EvidenceRepository, useValue: evidenceRepository },
        { provide: RawEvidenceRepository, useValue: rawEvidenceRepository },
        {
          provide: ResolveEvidenceSourceUseCase,
          useValue: resolveEvidenceSource,
        },
        {
          provide: ResolveSourceCacheTtlUseCase,
          useValue: resolveSourceCacheTtl,
        },
      ],
    }).compile();

    useCase = moduleRef.get(OpenEvidenceBatchUseCase);
  });

  it('abre a carga da fonte', async () => {
    const batch = await useCase.execute({ sourceSlug: 'IBAMA', collectedAt });

    expect(batch.sourceSlug).toBe('IBAMA');
  });

  it('lê a fonte e a janela de validade do catálogo uma vez só, na abertura', async () => {
    const batch = await useCase.execute({ sourceSlug: 'IBAMA', collectedAt });
    await batch.write([
      { cnpj: IBAMA_CNPJ, finding: { reference: '1' }, raw: {} },
      { cnpj: IBAMA_CNPJ, finding: { reference: '2' }, raw: {} },
    ]);

    expect(resolveEvidenceSource.execute).toHaveBeenCalledOnce();
    expect(resolveEvidenceSource.execute).toHaveBeenCalledWith('IBAMA');
    expect(resolveSourceCacheTtl.execute).toHaveBeenCalledOnce();
    expect(resolveSourceCacheTtl.execute).toHaveBeenCalledWith('IBAMA');
  });

  it('a validade das evidências é a data da carga mais a janela da fonte', async () => {
    const batch = await useCase.execute({ sourceSlug: 'IBAMA', collectedAt });

    await batch.write([
      { cnpj: IBAMA_CNPJ, finding: { reference: '1' }, raw: {} },
    ]);

    expect(evidenceRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        collectedAt,
        validUntil: new Date(collectedAt.getTime() + TTL_SECONDS * 1_000),
      }),
    );
  });

  it('a execução de ingestão acompanha os registros brutos', async () => {
    const batch = await useCase.execute({
      sourceSlug: 'IBAMA',
      collectedAt,
      ingestionRunId: 'run-9',
    });

    await batch.write([
      { cnpj: IBAMA_CNPJ, finding: { reference: '1' }, raw: {} },
    ]);

    expect(rawEvidenceRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ ingestionRunId: 'run-9' }),
    );
  });

  it('sem execução, o registro bruto não tem execução', async () => {
    const batch = await useCase.execute({ sourceSlug: 'IBAMA', collectedAt });

    await batch.write([
      { cnpj: IBAMA_CNPJ, finding: { reference: '1' }, raw: {} },
    ]);

    expect(rawEvidenceRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ ingestionRunId: null }),
    );
  });

  it('recusa a fonte que não é de evidências, sem consultar a janela', async () => {
    resolveEvidenceSource.execute.mockResolvedValue(null);

    await expect(
      useCase.execute({ sourceSlug: 'BRASIL_API', collectedAt }),
    ).rejects.toBeInstanceOf(EvidenceSourceNotFoundError);

    expect(resolveSourceCacheTtl.execute).not.toHaveBeenCalled();
  });

  it('o encerramento remove o que a carga não renovou, com o corte na data da carga', async () => {
    const batch = await useCase.execute({ sourceSlug: 'IBAMA', collectedAt });

    await batch.finish();

    expect(evidenceRepository.deleteNotCollectedSince).toHaveBeenCalledWith(
      source.id,
      collectedAt,
    );
  });
});
