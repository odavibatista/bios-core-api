import { Test } from '@nestjs/testing';
import { evidenceSourceFactory } from '@test/factories/evidences/evidence.factory.js';
import { DataSourceRepository } from '../../../domain/dtos/repositories/data-source.repository.js';
import { ResolveEvidenceSourceUseCase } from './resolve-evidence-source.usecase.js';

describe('ResolveEvidenceSourceUseCase', () => {
  const dataSourceRepository = {
    findEvidenceSource: vi.fn<DataSourceRepository['findEvidenceSource']>(),
  };
  let useCase: ResolveEvidenceSourceUseCase;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ResolveEvidenceSourceUseCase,
        { provide: DataSourceRepository, useValue: dataSourceRepository },
      ],
    }).compile();

    useCase = moduleRef.get(ResolveEvidenceSourceUseCase);
  });

  it('devolve a categoria e o ODS que o catálogo guarda para a fonte', async () => {
    const source = evidenceSourceFactory.build();
    dataSourceRepository.findEvidenceSource.mockResolvedValue(source);

    await expect(useCase.execute(source.slug)).resolves.toBe(source);

    expect(dataSourceRepository.findEvidenceSource).toHaveBeenCalledWith(
      source.slug,
    );
  });

  it('devolve null quando a fonte não é de evidências', async () => {
    dataSourceRepository.findEvidenceSource.mockResolvedValue(null);

    await expect(useCase.execute('BRASIL_API')).resolves.toBeNull();
  });

  it('propaga a falha do banco', async () => {
    dataSourceRepository.findEvidenceSource.mockRejectedValue(
      new Error('banco fora'),
    );

    await expect(useCase.execute('IBAMA')).rejects.toThrow('banco fora');
  });
});
