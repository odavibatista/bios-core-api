import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_ROUTE } from '@shared/http/decorators/public.decorator.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { GetScoreExplanationUseCase } from '../../infra/usecases/get-score-explanation.usecase.js';
import { ScoreExplanationController } from './score-explanation.controller.js';

describe('ScoreExplanationController', () => {
  const get = { execute: vi.fn<GetScoreExplanationUseCase['execute']>() };
  let controller: ScoreExplanationController;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [ScoreExplanationController],
      providers: [{ provide: GetScoreExplanationUseCase, useValue: get }],
    }).compile();
    controller = module.get(ScoreExplanationController);
  });

  it('encaminha os parâmetros sem coletar ou recalcular no controller', async () => {
    const params = { cnpj: buildCnpj(), odsNumber: '15' };
    const response: Awaited<ReturnType<GetScoreExplanationUseCase['execute']>> =
      {
        cnpj: params.cnpj,
        ods_number: 15,
        index_status: 'UNAVAILABLE',
        score_value: null,
        confidence_value: 0,
        evidence_count: 0,
        coverage_status: 'NO_RECORDS_IN_ALL_SOURCES',
        sources_without_records: ['IBAMA', 'CGU_CEIS', 'CGU_CNEP'],
        rules_version: 'rf10-rf11-v2',
        calculated_at: new Date().toISOString(),
        contributions: [],
      };
    get.execute.mockResolvedValue(response);
    await expect(controller.getExplanation(params)).resolves.toBe(response);
    expect(get.execute).toHaveBeenCalledWith(params);
  });

  it('propaga erro ao filtro e exige sessão', async () => {
    get.execute.mockRejectedValue(new Error('banco fora'));
    await expect(
      controller.getExplanation({ cnpj: buildCnpj(), odsNumber: '15' }),
    ).rejects.toThrow('banco fora');
    const reflector = new Reflector();
    for (const target of [
      ScoreExplanationController,
      ScoreExplanationController.prototype.getExplanation,
    ])
      expect(reflector.get(IS_PUBLIC_ROUTE, target)).toBeUndefined();
  });
});
