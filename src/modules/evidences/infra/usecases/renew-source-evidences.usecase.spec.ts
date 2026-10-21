import { Test } from '@nestjs/testing';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import { ResolveEvidenceSourceUseCase } from '@modules/data-sources/infra/usecases/evidence/resolve-evidence-source.usecase.js';
import { evidenceSourceFactory } from '@test/factories/evidences/evidence.factory.js';
import { faker } from '@test/support/faker.js';
import { EvidenceSourceNotFoundError } from '../../domain/dtos/errors/evidence.errors.js';
import { EvidenceRepository } from '../../domain/dtos/repositories/evidence.repository.js';
import { RenewSourceEvidencesUseCase } from './renew-source-evidences.usecase.js';

describe('RenewSourceEvidencesUseCase', () => {
  const evidenceRepository = {
    renewValidity: vi.fn<EvidenceRepository['renewValidity']>(),
  };
  const resolveEvidenceSource = {
    execute: vi.fn<ResolveEvidenceSourceUseCase['execute']>(),
  };
  const resolveSourceCacheTtl = {
    execute: vi.fn<ResolveSourceCacheTtlUseCase['execute']>(),
  };
  let useCase: RenewSourceEvidencesUseCase;

  const source = evidenceSourceFactory.build({ slug: 'IBAMA' });
  const TTL_SECONDS = 2 * 86_400;

  beforeEach(async () => {
    evidenceRepository.renewValidity.mockResolvedValue(0);
    resolveEvidenceSource.execute.mockResolvedValue(source);
    resolveSourceCacheTtl.execute.mockResolvedValue(TTL_SECONDS);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RenewSourceEvidencesUseCase,
        { provide: EvidenceRepository, useValue: evidenceRepository },
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

    useCase = moduleRef.get(RenewSourceEvidencesUseCase);
  });

  it('renova a fonte inteira: coleta em collectedAt e validade pela janela do catálogo', async () => {
    const collectedAt = faker.date.recent();
    evidenceRepository.renewValidity.mockResolvedValue(42);

    await expect(
      useCase.execute({ sourceSlug: 'IBAMA', collectedAt }),
    ).resolves.toBe(42);

    expect(resolveSourceCacheTtl.execute).toHaveBeenCalledWith('IBAMA');
    expect(evidenceRepository.renewValidity).toHaveBeenCalledWith(
      source.id,
      collectedAt,
      new Date(collectedAt.getTime() + TTL_SECONDS * 1_000),
    );
  });

  it('recusa fonte que não é de evidências, sem renovar nada', async () => {
    resolveEvidenceSource.execute.mockResolvedValue(null);

    await expect(
      useCase.execute({ sourceSlug: 'BRASIL_API', collectedAt: new Date() }),
    ).rejects.toBeInstanceOf(EvidenceSourceNotFoundError);

    expect(evidenceRepository.renewValidity).not.toHaveBeenCalled();
  });

  it('propaga a falha do banco', async () => {
    evidenceRepository.renewValidity.mockRejectedValue(new Error('banco fora'));

    await expect(
      useCase.execute({ sourceSlug: 'IBAMA', collectedAt: new Date() }),
    ).rejects.toThrow('banco fora');
  });
});
