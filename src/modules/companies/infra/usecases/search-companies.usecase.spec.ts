import { Test } from '@nestjs/testing';
import { companyProfileResponseFactory } from '@test/factories/companies/company-profile.factory.js';
import { CompanyProfileRepository } from '../../domain/dtos/repositories/company-profile.repository.js';
import { SearchCompaniesUseCase } from './search-companies.usecase.js';

describe('SearchCompaniesUseCase', () => {
  const companyProfileRepository = {
    search: vi.fn<CompanyProfileRepository['search']>(),
  };
  let useCase: SearchCompaniesUseCase;

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
      ods_score: null,
    };
  }

  beforeEach(async () => {
    companyProfileRepository.search.mockResolvedValue({
      items: [],
      total: 0,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        SearchCompaniesUseCase,
        {
          provide: CompanyProfileRepository,
          useValue: companyProfileRepository,
        },
      ],
    }).compile();

    useCase = moduleRef.get(SearchCompaniesUseCase);
  });

  it('normaliza o texto digitado em palavras antes de procurar', async () => {
    await useCase.execute({
      name: ' Indústria  S.A. ',
      page: 1,
      page_size: 20,
    });

    expect(companyProfileRepository.search).toHaveBeenCalledWith({
      nameTerms: ['INDUSTRIA', 'S', 'A'],
      skip: 0,
      take: 20,
    });
  });

  it('sem nome, procura sem palavras de nome', async () => {
    await useCase.execute({ uf: 'SP', page: 1, page_size: 20 });

    expect(companyProfileRepository.search).toHaveBeenCalledWith(
      expect.objectContaining({ nameTerms: [], uf: 'SP' }),
    );
  });

  it('traduz município, CNAE e ODS para o critério do repositório', async () => {
    await useCase.execute({
      city: "Santa Bárbara d'Oeste",
      cnae: '62',
      ods: 15,
      min_score: -20,
      min_confidence: 0.5,
      page: 1,
      page_size: 20,
    });

    expect(companyProfileRepository.search).toHaveBeenCalledWith({
      nameTerms: [],
      cityTerms: ['SANTA', 'BARBARA', 'D', 'OESTE'],
      cnaePrefix: '62',
      ods: { number: 15, minScore: -20, minConfidence: 0.5 },
      skip: 0,
      take: 20,
    });
  });

  it('o ODS sem mínimos vai sem mínimos', async () => {
    await useCase.execute({ ods: 13, page: 1, page_size: 20 });

    expect(companyProfileRepository.search).toHaveBeenCalledWith(
      expect.objectContaining({
        ods: { number: 13, minScore: undefined, minConfidence: undefined },
      }),
    );
  });

  it('traduz a página pedida em quantos itens pular', async () => {
    await useCase.execute({ name: 'petrobras', page: 3, page_size: 25 });

    expect(companyProfileRepository.search).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 50, take: 25 }),
    );
  });

  it('devolve a página e a paginação calculada pelo total', async () => {
    const items = [buildItem(), buildItem()];
    companyProfileRepository.search.mockResolvedValue({
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
    companyProfileRepository.search.mockRejectedValue(new Error('banco fora'));

    await expect(
      useCase.execute({ name: 'natura', page: 1, page_size: 20 }),
    ).rejects.toThrow('banco fora');
  });
});
