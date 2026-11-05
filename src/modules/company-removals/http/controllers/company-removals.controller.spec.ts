import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { REQUIRED_ROLES } from '@shared/http/decorators/roles.decorator.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { ListCompanyRemovalsUseCase } from '../../infra/usecases/list-company-removals.usecase.js';
import { RemoveCompanyUseCase } from '../../infra/usecases/remove-company.usecase.js';
import { RestoreCompanyUseCase } from '../../infra/usecases/restore-company.usecase.js';
import { CompanyRemovalsController } from './company-removals.controller.js';

describe('CompanyRemovalsController', () => {
  const list = { execute: vi.fn() };
  const remove = { execute: vi.fn() };
  const restore = { execute: vi.fn() };
  let controller: CompanyRemovalsController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CompanyRemovalsController],
      providers: [
        { provide: ListCompanyRemovalsUseCase, useValue: list },
        { provide: RemoveCompanyUseCase, useValue: remove },
        { provide: RestoreCompanyUseCase, useValue: restore },
      ],
    }).compile();

    controller = moduleRef.get(CompanyRemovalsController);
  });

  it('é exclusiva de administrador', () => {
    expect(
      new Reflector().get<UserRole[]>(
        REQUIRED_ROLES,
        CompanyRemovalsController,
      ),
    ).toEqual([UserRole.ADMIN]);
  });

  it('lista, retira e devolve pelos casos de uso', async () => {
    const cnpj = buildCnpj();
    const page = { data: [], pagination: {} };
    const removal = { cnpj, removed_at: '2026-11-05T12:00:00.000Z' };
    list.execute.mockResolvedValue(page);
    remove.execute.mockResolvedValue(removal);
    restore.execute.mockResolvedValue(undefined);

    await expect(controller.list({ page: 1, page_size: 20 })).resolves.toBe(
      page,
    );
    await expect(controller.add({ cnpj })).resolves.toBe(removal);
    await expect(controller.restore(cnpj)).resolves.toBeUndefined();

    expect(remove.execute).toHaveBeenCalledWith(cnpj);
    expect(restore.execute).toHaveBeenCalledWith(cnpj);
  });
});
