import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_ROUTE } from '@shared/http/decorators/public.decorator.js';
import { SearchCompaniesUseCase } from '../../infra/usecases/search-companies.usecase.js';
import { CompaniesController } from './companies.controller.js';

describe('CompaniesController', () => {
  const searchCompaniesByName = { execute: vi.fn() };
  let controller: CompaniesController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CompaniesController],
      providers: [
        {
          provide: SearchCompaniesUseCase,
          useValue: searchCompaniesByName,
        },
      ],
    }).compile();

    controller = moduleRef.get(CompaniesController);
  });

  describe('pesquisa de empresas', () => {
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
      expect(
        new Reflector().get<boolean | undefined>(
          IS_PUBLIC_ROUTE,
          CompaniesController,
        ),
      ).toBeUndefined();
    });
  });
});
