import { CompanyMovementRepository } from '../../domain/dtos/repositories/company-movement.repository.js';
import { ListCompanyMovementsUseCase } from './list-company-movements.usecase.js';

describe('ListCompanyMovementsUseCase', () => {
  it('lê a janela pedida', async () => {
    const page = { rows: [], total: 0 };
    const findPage = vi.fn<CompanyMovementRepository['findPage']>();

    findPage.mockResolvedValue(page);

    const useCase = new ListCompanyMovementsUseCase({
      findPage,
    } as unknown as CompanyMovementRepository);

    await expect(useCase.execute({ skip: 20, take: 10 })).resolves.toBe(page);
    expect(findPage).toHaveBeenCalledWith({ skip: 20, take: 10 });
  });
});
