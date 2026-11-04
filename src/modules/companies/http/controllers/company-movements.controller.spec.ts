import { Test } from '@nestjs/testing';
import { ListRecentCompanyMovementsUseCase } from '../../infra/usecases/list-recent-company-movements.usecase.js';
import { CompanyMovementsController } from './company-movements.controller.js';

describe('CompanyMovementsController', () => {
  const listRecent = {
    execute: vi.fn<ListRecentCompanyMovementsUseCase['execute']>(),
  };
  let controller: CompanyMovementsController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CompanyMovementsController],
      providers: [
        { provide: ListRecentCompanyMovementsUseCase, useValue: listRecent },
      ],
    }).compile();

    controller = moduleRef.get(CompanyMovementsController);
  });

  it('repassa a página pedida e devolve a lista', async () => {
    const response = {
      data: [],
      pagination: { page: 2, page_size: 10, total: 0, total_pages: 0 },
    };

    listRecent.execute.mockResolvedValue(response);

    await expect(
      controller.listCompanyMovements({ page: 2, page_size: 10 }),
    ).resolves.toBe(response);
    expect(listRecent.execute).toHaveBeenCalledWith({ page: 2, page_size: 10 });
  });
});
