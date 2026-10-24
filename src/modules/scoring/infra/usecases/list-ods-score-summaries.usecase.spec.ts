import { ListOdsScoreSummariesUseCase } from './list-ods-score-summaries.usecase.js';

describe('ListOdsScoreSummariesUseCase', () => {
  const scores = { findActiveOds: vi.fn(), findSummariesByCnpjs: vi.fn() };
  let useCase: ListOdsScoreSummariesUseCase;

  const summary = (cnpj: string, odsNumber: number) => ({
    cnpj,
    odsNumber,
    scoreValue: 10,
    confidenceValue: 0.5,
  });

  beforeEach(() => {
    scores.findActiveOds.mockResolvedValue([
      { id: 'b', number: 15 },
      { id: 'a', number: 13 },
    ]);
    scores.findSummariesByCnpjs.mockResolvedValue([]);
    useCase = new ListOdsScoreSummariesUseCase(scores as never);
  });

  it('devolve os ODS ativos em ordem de número', async () => {
    const { odsNumbers } = await useCase.execute(['11222333000181']);

    expect(odsNumbers).toEqual([13, 15]);
  });

  it('lê os resumos das empresas pedidas', async () => {
    scores.findSummariesByCnpjs.mockResolvedValue([
      summary('11222333000181', 13),
    ]);

    const { summaries } = await useCase.execute(['11222333000181']);

    expect(scores.findSummariesByCnpjs).toHaveBeenCalledWith([
      '11222333000181',
    ]);
    expect(summaries).toEqual([summary('11222333000181', 13)]);
  });

  it('descarta o retrato de ODS desativado', async () => {
    scores.findSummariesByCnpjs.mockResolvedValue([
      summary('11222333000181', 13),
      summary('11222333000181', 11),
    ]);

    const { summaries } = await useCase.execute(['11222333000181']);

    expect(summaries.map(({ odsNumber }) => odsNumber)).toEqual([13]);
  });

  it('propaga a falha do banco', async () => {
    scores.findSummariesByCnpjs.mockRejectedValue(new Error('banco fora'));

    await expect(useCase.execute(['11222333000181'])).rejects.toThrow(
      'banco fora',
    );
  });
});
