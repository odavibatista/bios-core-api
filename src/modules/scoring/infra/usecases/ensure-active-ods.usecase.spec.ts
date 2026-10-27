import { OdsNotAvailableException } from '../../domain/dtos/errors/ods-not-available.errors.js';
import { EnsureActiveOdsUseCase } from './ensure-active-ods.usecase.js';

describe('EnsureActiveOdsUseCase', () => {
  const scores = { findActiveOds: vi.fn() };
  let useCase: EnsureActiveOdsUseCase;

  beforeEach(() => {
    scores.findActiveOds.mockResolvedValue([
      { id: 'b', number: 15 },
      { id: 'a', number: 13 },
    ]);
    useCase = new EnsureActiveOdsUseCase(scores as never);
  });

  it.each([13, 15])('aceita o ODS ativo %i', async (ods) => {
    await expect(useCase.execute(ods)).resolves.toBeUndefined();
  });

  it('recusa o ODS que o BIOS não calcula com 422 e a lista dos válidos em ordem', async () => {
    const error = await useCase.execute(7).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OdsNotAvailableException);
    expect(error).toMatchObject({
      code: 'ODS_NOT_AVAILABLE',
      details: { ods: 7, valid_ods: [13, 15] },
    });
    expect((error as OdsNotAvailableException).getStatus()).toBe(422);
    expect((error as OdsNotAvailableException).message).toContain('13, 15');
  });

  it('ODS desativado some do catálogo e passa a ser recusado', async () => {
    scores.findActiveOds.mockResolvedValue([{ id: 'a', number: 13 }]);

    await expect(useCase.execute(15)).rejects.toMatchObject({
      details: { ods: 15, valid_ods: [13] },
    });
  });

  it('sem nenhum ODS ativo, recusa e diz que não há ODS disponível', async () => {
    scores.findActiveOds.mockResolvedValue([]);

    const error = await useCase.execute(13).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ details: { ods: 13, valid_ods: [] } });
    expect((error as Error).message).toContain('nenhum');
  });

  it('propaga a falha do banco', async () => {
    scores.findActiveOds.mockRejectedValue(new Error('banco fora'));

    await expect(useCase.execute(13)).rejects.toThrow('banco fora');
  });
});
