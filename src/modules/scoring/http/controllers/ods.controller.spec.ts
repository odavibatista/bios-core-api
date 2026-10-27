import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_ROUTE } from '@shared/http/decorators/public.decorator.js';
import { ListOdsUseCase } from '../../infra/usecases/list-ods.usecase.js';
import { OdsController } from './ods.controller.js';

describe('OdsController', () => {
  const list = { execute: vi.fn<ListOdsUseCase['execute']>() };
  let controller: OdsController;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [OdsController],
      providers: [{ provide: ListOdsUseCase, useValue: list }],
    }).compile();
    controller = module.get(OdsController);
  });

  it('devolve o catálogo lido pelo caso de uso', async () => {
    const response = {
      data: [{ ods_number: 15, title: 'Vida Terrestre', description: 'x' }],
    };
    list.execute.mockResolvedValue(response);

    await expect(controller.listOds()).resolves.toBe(response);
  });

  it('propaga erro ao filtro e exige sessão', async () => {
    list.execute.mockRejectedValue(new Error('banco fora'));
    await expect(controller.listOds()).rejects.toThrow('banco fora');

    const reflector = new Reflector();
    for (const target of [OdsController, OdsController.prototype.listOds]) {
      expect(reflector.get(IS_PUBLIC_ROUTE, target)).toBeUndefined();
    }
  });
});
