import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ApiKeyGuard } from '@modules/api-keys/http/guards/api-key.guard.js';
import { ThrottlerName } from '@shared/config/throttler.config.js';
import { IS_PUBLIC_API_ROUTE } from '@shared/http/decorators/public-api-route.decorator.js';
import { IS_PUBLIC_ROUTE } from '@shared/http/decorators/public.decorator.js';
import { ROUTE_RATE_LIMIT } from '@shared/http/decorators/route-rate-limit.decorator.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import {
  CRM_IMPORT_MAX_CNPJS,
  CrmImportRequestSchema,
} from '../../domain/dtos/requests/crm-import.dto.js';
import { ImportCrmAccountsUseCase } from '../../infra/usecases/import-crm-accounts.usecase.js';
import { CrmImportController } from './crm-import.controller.js';

describe('CrmImportController', () => {
  const importAccounts = { execute: vi.fn() };
  let controller: CrmImportController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CrmImportController],
      providers: [
        { provide: ImportCrmAccountsUseCase, useValue: importAccounts },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(CrmImportController);
  });

  it('repassa o lote ao caso de uso', async () => {
    const response = { data: [] };
    const body = { cnpjs: [buildCnpj()] };
    importAccounts.execute.mockResolvedValue(response);

    await expect(controller.importCompanies(body)).resolves.toBe(response);

    expect(importAccounts.execute).toHaveBeenCalledWith(body);
  });

  it('autentica pela chave de API e tem limite próprio, além do limite por chave', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      CrmImportController.prototype,
      'importCompanies',
    )?.value as () => unknown;

    expect(reflector.get<boolean>(IS_PUBLIC_ROUTE, CrmImportController)).toBe(
      true,
    );
    expect(
      reflector.get<boolean>(IS_PUBLIC_API_ROUTE, CrmImportController),
    ).toBe(true);
    expect(
      reflector.get<unknown[]>(GUARDS_METADATA, CrmImportController),
    ).toContain(ApiKeyGuard);
    expect(reflector.get<string>(ROUTE_RATE_LIMIT, handler)).toBe(
      ThrottlerName.CRM_IMPORT,
    );
  });

  it('o lote tem de 1 ao teto de CNPJs', () => {
    const lot = (size: number) => ({
      cnpjs: Array.from({ length: size }, () => buildCnpj()),
    });

    expect(CrmImportRequestSchema.safeParse(lot(0)).success).toBe(false);
    expect(
      CrmImportRequestSchema.safeParse(lot(CRM_IMPORT_MAX_CNPJS)).success,
    ).toBe(true);
    expect(
      CrmImportRequestSchema.safeParse(lot(CRM_IMPORT_MAX_CNPJS + 1)).success,
    ).toBe(false);
  });
});
