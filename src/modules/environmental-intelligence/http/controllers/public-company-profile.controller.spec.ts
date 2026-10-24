import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ApiKeyGuard } from '@modules/api-keys/http/guards/api-key.guard.js';
import { IS_PUBLIC_API_ROUTE } from '@shared/http/decorators/public-api-route.decorator.js';
import { IS_PUBLIC_ROUTE } from '@shared/http/decorators/public.decorator.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { companyFullProfileResponseFactory } from '@test/factories/companies/company-full-profile.factory.js';
import { GetCompanyFullProfileUseCase } from '../../infra/usecases/get-company-full-profile.usecase.js';
import { PublicCompanyProfileController } from './public-company-profile.controller.js';

describe('PublicCompanyProfileController', () => {
  const getFullProfile = { execute: vi.fn() };
  let controller: PublicCompanyProfileController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicCompanyProfileController],
      providers: [
        { provide: GetCompanyFullProfileUseCase, useValue: getFullProfile },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(PublicCompanyProfileController);
  });

  it('executa a mesma consulta do painel e devolve o perfil completo', async () => {
    const profile = companyFullProfileResponseFactory.build();
    const cnpj = buildCnpj();
    getFullProfile.execute.mockResolvedValue(profile);

    await expect(controller.getCompanyProfile(cnpj)).resolves.toBe(profile);

    expect(getFullProfile.execute).toHaveBeenCalledWith(cnpj);
  });

  it('propaga a recusa do caso de uso', async () => {
    getFullProfile.execute.mockRejectedValue(new Error('não encontrada'));

    await expect(controller.getCompanyProfile(buildCnpj())).rejects.toThrow(
      'não encontrada',
    );
  });

  describe('autenticação e limite', () => {
    const reflector = new Reflector();

    it('é aberto à sessão, porque se autentica pela chave de API', () => {
      expect(
        reflector.get<boolean>(IS_PUBLIC_ROUTE, PublicCompanyProfileController),
      ).toBe(true);
    });

    it('exige a chave de API pelo guard próprio', () => {
      expect(
        reflector.get<unknown[]>(
          GUARDS_METADATA,
          PublicCompanyProfileController,
        ),
      ).toContain(ApiKeyGuard);
    });

    it('conta o limite de requisições por chave', () => {
      expect(
        reflector.get<boolean>(
          IS_PUBLIC_API_ROUTE,
          PublicCompanyProfileController,
        ),
      ).toBe(true);
    });
  });
});
