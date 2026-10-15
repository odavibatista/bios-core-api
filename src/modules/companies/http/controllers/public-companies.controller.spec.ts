import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ApiKeyGuard } from '@modules/api-keys/http/guards/api-key.guard.js';
import { IS_PUBLIC_API_ROUTE } from '@shared/http/decorators/public-api-route.decorator.js';
import { IS_PUBLIC_ROUTE } from '@shared/http/decorators/public.decorator.js';
import {
  buildCnpj,
  companyProfileResponseFactory,
} from '@test/factories/companies/company-profile.factory.js';
import { GetCompanyProfileUseCase } from '../../infra/usecases/get-company-profile.usecase.js';
import { PublicCompaniesController } from './public-companies.controller.js';

describe('PublicCompaniesController', () => {
  const getCompanyProfile = { execute: vi.fn() };
  let controller: PublicCompaniesController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicCompaniesController],
      providers: [
        { provide: GetCompanyProfileUseCase, useValue: getCompanyProfile },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(PublicCompaniesController);
  });

  it('executa a mesma consulta do painel e devolve o perfil', async () => {
    const profile = companyProfileResponseFactory.build();
    const cnpj = buildCnpj();
    getCompanyProfile.execute.mockResolvedValue(profile);

    await expect(controller.getCompanyProfile(cnpj)).resolves.toBe(profile);

    expect(getCompanyProfile.execute).toHaveBeenCalledWith(cnpj);
  });

  it('propaga a recusa do caso de uso', async () => {
    getCompanyProfile.execute.mockRejectedValue(new Error('não encontrada'));

    await expect(controller.getCompanyProfile(buildCnpj())).rejects.toThrow(
      'não encontrada',
    );
  });

  describe('autenticação e limite', () => {
    const reflector = new Reflector();

    it('é aberto à sessão, porque se autentica pela chave de API', () => {
      expect(
        reflector.get<boolean>(IS_PUBLIC_ROUTE, PublicCompaniesController),
      ).toBe(true);
    });

    it('exige a chave de API pelo guard próprio', () => {
      expect(
        reflector.get<unknown[]>(GUARDS_METADATA, PublicCompaniesController),
      ).toContain(ApiKeyGuard);
    });

    it('conta o limite de requisições por chave', () => {
      expect(
        reflector.get<boolean>(IS_PUBLIC_API_ROUTE, PublicCompaniesController),
      ).toBe(true);
    });
  });
});
