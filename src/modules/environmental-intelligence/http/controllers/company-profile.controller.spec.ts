import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_ROUTE } from '@shared/http/decorators/public.decorator.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { companyFullProfileResponseFactory } from '@test/factories/companies/company-full-profile.factory.js';
import { CompanyFullProfileResponseSchema } from '../../domain/dtos/requests/company-full-profile.dto.js';
import { GetCompanyFullProfileUseCase } from '../../infra/usecases/get-company-full-profile.usecase.js';
import { CompanyProfileController } from './company-profile.controller.js';

describe('CompanyProfileController', () => {
  const getFullProfile = { execute: vi.fn() };
  let controller: CompanyProfileController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CompanyProfileController],
      providers: [
        { provide: GetCompanyFullProfileUseCase, useValue: getFullProfile },
      ],
    }).compile();

    controller = moduleRef.get(CompanyProfileController);
  });

  it('entrega o CNPJ da rota ao caso de uso e devolve o perfil completo', async () => {
    const profile = companyFullProfileResponseFactory.build();
    const cnpj = buildCnpj();
    getFullProfile.execute.mockResolvedValue(profile);

    await expect(controller.getCompanyProfile(cnpj)).resolves.toBe(profile);

    expect(getFullProfile.execute).toHaveBeenCalledWith(cnpj);
  });

  it('o perfil de exemplo obedece ao schema da resposta', () => {
    expect(
      CompanyFullProfileResponseSchema.safeParse(
        companyFullProfileResponseFactory.build(),
      ).success,
    ).toBe(true);
  });

  it('propaga a recusa do caso de uso', async () => {
    getFullProfile.execute.mockRejectedValue(new Error('não encontrada'));

    await expect(controller.getCompanyProfile(buildCnpj())).rejects.toThrow(
      'não encontrada',
    );
  });

  it('exige sessão: a consulta de empresas não é pública', () => {
    const reflector = new Reflector();

    expect(
      reflector.get<boolean | undefined>(
        IS_PUBLIC_ROUTE,
        CompanyProfileController.prototype.getCompanyProfile,
      ),
    ).toBeUndefined();
    expect(
      reflector.get<boolean | undefined>(
        IS_PUBLIC_ROUTE,
        CompanyProfileController,
      ),
    ).toBeUndefined();
  });
});
