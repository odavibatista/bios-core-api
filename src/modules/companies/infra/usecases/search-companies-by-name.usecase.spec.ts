import { Test } from '@nestjs/testing';
import { companyProfileResponseFactory } from '@test/factories/companies/company-profile.factory.js';
import { CompanyProfileRepository } from '../../domain/dtos/repositories/company-profile.repository.js';
import { SearchCompaniesByNameUseCase } from './search-companies-by-name.usecase.js';

describe('SearchCompaniesByNameUseCase', () => {
  const companyProfileRepository = {
    searchByName: vi.fn<CompanyProfileRepository['searchByName']>(),
  };
  let useCase: SearchCompaniesByNameUseCase;

  function buildItem() {
    const { cnpj, legal_name, trade_name, registration_status, main_cnae } =
      companyProfileResponseFactory.build();

    return {
      cnpj,
      legal_name,
      trade_name,
      registration_status,
      city: 'SAO PAULO',
      uf: 'SP',
      main_cnae,
    };
  }

  beforeEach(async () => {
    companyProfileRepository.searchByName.mockResolvedValue({
      items: [],
      total: 0,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        SearchCompaniesByNameUseCase,
        {
          provide: CompanyProfileRepository,
          useValue: companyProfileRepository,
        },
      ],
    }).compile();

    useCase = moduleRef.get(SearchCompaniesByNameUseCase);
  });

  it('normaliza o texto digitado em palavras antes de procurar', async () => {
    await useCase.execute({
      name: ' Indústria  S.A. ',
      page: 1,
      page_size: 20,
    });

    expect(companyProfileRepository.searchByName).toHaveBeenCalledWith({
      terms: ['INDUSTRIA', 'S', 'A'],
      skip: 0,
      take: 20,
    });
  });

  it('traduz a página pedida em quantos itens pular', async () => {
    await useCase.execute({ name: 'petrobras', page: 3, page_size: 25 });

    expect(companyProfileRepository.searchByName).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 50, take: 25 }),
    );
  });

  it('devolve a página e a paginação calculada pelo total', async () => {
    const items = [buildItem(), buildItem()];
    companyProfileRepository.searchByName.mockResolvedValue({
      items,
      total: 42,
    });

    await expect(
      useCase.execute({ name: 'natura', page: 2, page_size: 20 }),
    ).resolves.toEqual({
      data: items,
      pagination: { page: 2, page_size: 20, total: 42, total_pages: 3 },
    });
  });

  it('nada encontrado não é erro: devolve a lista vazia', async () => {
    await expect(
      useCase.execute({ name: 'inexistente', page: 1, page_size: 20 }),
    ).resolves.toEqual({
      data: [],
      pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 },
    });
  });

  it('propaga a falha do banco', async () => {
    companyProfileRepository.searchByName.mockRejectedValue(
      new Error('banco fora'),
    );

    await expect(
      useCase.execute({ name: 'natura', page: 1, page_size: 20 }),
    ).rejects.toThrow('banco fora');
  });
});
