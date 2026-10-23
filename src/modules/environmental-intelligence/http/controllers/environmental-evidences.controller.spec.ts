import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_ROUTE } from '@shared/http/decorators/public.decorator.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { groupCompanyEvidences } from '@modules/evidences/domain/company-environmental-evidences.dto.js';
import { GetCompanyEnvironmentalEvidencesUseCase } from '../../infra/usecases/get-company-environmental-evidences.usecase.js';
import { EnvironmentalEvidencesController } from './environmental-evidences.controller.js';
describe('EnvironmentalEvidencesController', () => {
  const get = {
    execute: vi.fn<GetCompanyEnvironmentalEvidencesUseCase['execute']>(),
  };
  let controller: EnvironmentalEvidencesController;
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [EnvironmentalEvidencesController],
      providers: [
        { provide: GetCompanyEnvironmentalEvidencesUseCase, useValue: get },
      ],
    }).compile();
    controller = module.get(EnvironmentalEvidencesController);
  });
  it('encaminha CNPJ validado e devolve grupos sem remodelar proveniência', async () => {
    const cnpj = buildCnpj(),
      response = groupCompanyEvidences(cnpj, []);
    get.execute.mockResolvedValue(response);
    await expect(controller.getCompanyEvidences({ cnpj })).resolves.toBe(
      response,
    );
    expect(get.execute).toHaveBeenCalledWith(cnpj);
  });
  it('propaga erro de infraestrutura ao filtro global', async () => {
    get.execute.mockRejectedValue(new Error('banco fora'));
    await expect(
      controller.getCompanyEvidences({ cnpj: buildCnpj() }),
    ).rejects.toThrow('banco fora');
  });
  it('exige sessão válida, sem marcar classe ou método como públicos', () => {
    const reflector = new Reflector();
    for (const target of [
      EnvironmentalEvidencesController,
      EnvironmentalEvidencesController.prototype.getCompanyEvidences,
    ])
      expect(reflector.get(IS_PUBLIC_ROUTE, target)).toBeUndefined();
  });
});
