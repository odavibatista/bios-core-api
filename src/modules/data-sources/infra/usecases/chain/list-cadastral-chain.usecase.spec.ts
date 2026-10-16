import { Test } from '@nestjs/testing';
import { DataSourceRepository } from '../../../domain/dtos/repositories/data-source.repository.js';
import { ListCadastralChainUseCase } from './list-cadastral-chain.usecase.js';

describe('ListCadastralChainUseCase', () => {
  const dataSourceRepository = {
    findCadastralChain: vi.fn<DataSourceRepository['findCadastralChain']>(),
  };
  let useCase: ListCadastralChainUseCase;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ListCadastralChainUseCase,
        { provide: DataSourceRepository, useValue: dataSourceRepository },
      ],
    }).compile();

    useCase = moduleRef.get(ListCadastralChainUseCase);
  });

  it('devolve os slugs na ordem em que o catálogo os entrega', async () => {
    dataSourceRepository.findCadastralChain.mockResolvedValue([
      'BRASIL_API',
      'OPEN_CNPJ',
      'MINHA_RECEITA',
    ]);

    await expect(useCase.execute()).resolves.toEqual([
      'BRASIL_API',
      'OPEN_CNPJ',
      'MINHA_RECEITA',
    ]);
  });

  it('devolve lista vazia quando nenhuma fonte cadastral está habilitada', async () => {
    dataSourceRepository.findCadastralChain.mockResolvedValue([]);

    await expect(useCase.execute()).resolves.toEqual([]);
  });

  it('propaga a falha do catálogo: quem chama decide a reserva', async () => {
    dataSourceRepository.findCadastralChain.mockRejectedValue(
      new Error('banco fora'),
    );

    await expect(useCase.execute()).rejects.toThrow('banco fora');
  });
});
