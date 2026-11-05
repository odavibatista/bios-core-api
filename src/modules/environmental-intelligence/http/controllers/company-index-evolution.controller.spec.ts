import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerName } from '@shared/config/throttler.config.js';
import { IS_PUBLIC_ROUTE } from '@shared/http/decorators/public.decorator.js';
import { ROUTE_RATE_LIMIT } from '@shared/http/decorators/route-rate-limit.decorator.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { GetCompanyIndexEvolutionUseCase } from '../../infra/usecases/get-company-index-evolution.usecase.js';
import { CompanyIndexEvolutionController } from './company-index-evolution.controller.js';

describe('CompanyIndexEvolutionController', () => {
  const evolution = { execute: vi.fn() };
  let controller: CompanyIndexEvolutionController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CompanyIndexEvolutionController],
      providers: [
        { provide: GetCompanyIndexEvolutionUseCase, useValue: evolution },
      ],
    }).compile();

    controller = moduleRef.get(CompanyIndexEvolutionController);
  });

  it('repassa o CNPJ ao caso de uso', async () => {
    const response = { cnpj: buildCnpj(), reconstructed: true, ods: [] };
    evolution.execute.mockResolvedValue(response);

    await expect(controller.getEvolution(response.cnpj)).resolves.toBe(
      response,
    );
    expect(evolution.execute).toHaveBeenCalledWith(response.cnpj);
  });

  it('exige sessão e usa o limite do perfil', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      CompanyIndexEvolutionController.prototype,
      'getEvolution',
    )?.value as () => unknown;

    expect(
      reflector.get<boolean>(IS_PUBLIC_ROUTE, CompanyIndexEvolutionController),
    ).toBeUndefined();
    expect(reflector.get<string>(ROUTE_RATE_LIMIT, handler)).toBe(
      ThrottlerName.COMPANY_PROFILE,
    );
  });
});
