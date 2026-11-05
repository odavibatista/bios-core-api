import { Test } from '@nestjs/testing';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { CompanyRemovalRepository } from '../../domain/dtos/repositories/company-removal.repository.js';
import { ListCompanyRemovalsUseCase } from './list-company-removals.usecase.js';

describe('ListCompanyRemovalsUseCase', () => {
  const removals = { list: vi.fn<CompanyRemovalRepository['list']>() };
  let useCase: ListCompanyRemovalsUseCase;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ListCompanyRemovalsUseCase,
        { provide: CompanyRemovalRepository, useValue: removals },
      ],
    }).compile();

    useCase = moduleRef.get(ListCompanyRemovalsUseCase);
  });

  it('pagina a lista e traz só o CNPJ e a data', async () => {
    const cnpj = buildCnpj();
    const removedAt = new Date('2026-11-05T12:00:00.000Z');
    removals.list.mockResolvedValue({
      rows: [{ cnpj, removedAt }],
      total: 21,
    });

    const response = await useCase.execute({ page: 2, page_size: 20 });

    expect(removals.list).toHaveBeenCalledWith({ skip: 20, take: 20 });
    expect(response.data).toEqual([
      { cnpj, removed_at: removedAt.toISOString() },
    ]);
    expect(response.pagination).toMatchObject({ total: 21, total_pages: 2 });
  });
});
