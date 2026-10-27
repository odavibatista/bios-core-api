import { OdsListResponseSchema } from '../../domain/dtos/requests/ods-catalog.dto.js';
import { ListOdsUseCase } from './list-ods.usecase.js';

describe('ListOdsUseCase', () => {
  const scores = { findOdsCatalog: vi.fn() };
  let useCase: ListOdsUseCase;

  beforeEach(() => {
    scores.findOdsCatalog.mockResolvedValue([
      { id: 'a', number: 13, title: 'Clima', description: 'Combater o clima.' },
      { id: 'b', number: 15, title: 'Vida', description: 'Proteger a terra.' },
    ]);
    useCase = new ListOdsUseCase(scores as never);
  });

  it('devolve número, título e descrição de cada ODS, sem o id interno', async () => {
    const response = await useCase.execute();

    expect(response).toEqual({
      data: [
        { ods_number: 13, title: 'Clima', description: 'Combater o clima.' },
        { ods_number: 15, title: 'Vida', description: 'Proteger a terra.' },
      ],
    });
    expect(OdsListResponseSchema.safeParse(response).success).toBe(true);
  });

  it('sem ODS ativo, devolve a lista vazia', async () => {
    scores.findOdsCatalog.mockResolvedValue([]);

    await expect(useCase.execute()).resolves.toEqual({ data: [] });
  });

  it('propaga a falha do banco', async () => {
    scores.findOdsCatalog.mockRejectedValue(new Error('banco fora'));

    await expect(useCase.execute()).rejects.toThrow('banco fora');
  });
});
