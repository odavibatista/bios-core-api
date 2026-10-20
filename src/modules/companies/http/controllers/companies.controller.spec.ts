import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_ROUTE } from '@shared/http/decorators/public.decorator.js';
import {
  buildCnpj,
  companyProfileResponseFactory,
} from '@test/factories/companies/company-profile.factory.js';
import { CompanyProfileResponseSchema } from '../../domain/dtos/requests/company-profile.dto.js';
import { GetCompanyProfileUseCase } from '../../infra/usecases/get-company-profile.usecase.js';
import { SearchCompaniesByNameUseCase } from '../../infra/usecases/search-companies-by-name.usecase.js';
import { CompaniesController } from './companies.controller.js';

describe('CompaniesController', () => {
  const getCompanyProfile = { execute: vi.fn() };
  const searchCompaniesByName = { execute: vi.fn() };
  let controller: CompaniesController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CompaniesController],
      providers: [
        { provide: GetCompanyProfileUseCase, useValue: getCompanyProfile },
        {
          provide: SearchCompaniesByNameUseCase,
          useValue: searchCompaniesByName,
        },
      ],
    }).compile();

    controller = moduleRef.get(CompaniesController);
  });

  it('entrega o CNPJ da rota ao caso de uso e devolve o perfil', async () => {
    const profile = companyProfileResponseFactory.build();
    const cnpj = buildCnpj();
    getCompanyProfile.execute.mockResolvedValue(profile);

    await expect(controller.getCompanyProfile(cnpj)).resolves.toBe(profile);

    expect(getCompanyProfile.execute).toHaveBeenCalledWith(cnpj);
  });

  it('o perfil de exemplo obedece ao schema da resposta', () => {
    expect(
      CompanyProfileResponseSchema.safeParse(
        companyProfileResponseFactory.build(),
      ).success,
    ).toBe(true);
  });

  it('propaga a recusa do caso de uso', async () => {
    getCompanyProfile.execute.mockRejectedValue(new Error('não encontrada'));

    await expect(controller.getCompanyProfile(buildCnpj())).rejects.toThrow(
      'não encontrada',
    );
  });

  describe('busca por nome', () => {
    const query = { name: 'petrobras', page: 2, page_size: 10 };

    it('entrega a query validada ao caso de uso e devolve a página', async () => {
      const page = {
        data: [],
        pagination: { page: 2, page_size: 10, total: 0, total_pages: 0 },
      };
      searchCompaniesByName.execute.mockResolvedValue(page);

      await expect(controller.searchCompanies(query)).resolves.toBe(page);

      expect(searchCompaniesByName.execute).toHaveBeenCalledWith(query);
    });

    it('propaga a falha do caso de uso', async () => {
      searchCompaniesByName.execute.mockRejectedValue(new Error('banco fora'));

      await expect(controller.searchCompanies(query)).rejects.toThrow(
        'banco fora',
      );
    });

    it('exige sessão: a busca não é pública', () => {
      expect(
        new Reflector().get<boolean | undefined>(
          IS_PUBLIC_ROUTE,
          CompaniesController.prototype.searchCompanies,
        ),
      ).toBeUndefined();
    });
  });

  it('exige sessão: a consulta de empresas não é pública', () => {
    const reflector = new Reflector();

    expect(
      reflector.get<boolean | undefined>(
        IS_PUBLIC_ROUTE,
        CompaniesController.prototype.getCompanyProfile,
      ),
    ).toBeUndefined();
    expect(
      reflector.get<boolean | undefined>(IS_PUBLIC_ROUTE, CompaniesController),
    ).toBeUndefined();
  });
});
