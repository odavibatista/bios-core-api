import { CityNotInStateException } from '../../domain/dtos/errors/location.errors.js';
import type {
  CityRecord,
  LocationRepository,
} from '../../domain/dtos/repositories/location.repository.js';
import { ListCitiesUseCase } from './list-cities.usecase.js';
import { ListStatesUseCase } from './list-states.usecase.js';
import { ResolveCityUseCase } from './resolve-city.usecase.js';

const city = (ibgeCode: number, name: string): CityRecord => ({
  ibgeCode,
  name,
  uf: 'PI',
  searchName: name.toUpperCase(),
  aliases: [],
});

describe('casos de uso de localidades', () => {
  const repository = {
    listStates: vi.fn<LocationRepository['listStates']>(),
    listCities: vi.fn<LocationRepository['listCities']>(),
    findCity: vi.fn<LocationRepository['findCity']>(),
  };

  beforeEach(() => {
    repository.listCities.mockResolvedValue([
      city(2211001, 'Teresina'),
      city(2200103, 'Acauã'),
      city(2209971, 'Tere'),
    ]);
  });

  it('lista as UFs com o código em texto', async () => {
    repository.listStates.mockResolvedValue([
      { ibgeCode: 22, acronym: 'PI', name: 'Piauí' },
    ]);

    await expect(new ListStatesUseCase(repository).execute()).resolves.toEqual({
      data: [{ ibge_code: '22', acronym: 'PI', name: 'Piauí' }],
    });
  });

  it('pagina os municípios depois de filtrar', async () => {
    const useCase = new ListCitiesUseCase(repository);

    const page = await useCase.execute({
      uf: 'PI',
      search: 'tere',
      page: 2,
      page_size: 1,
    });

    expect(repository.listCities).toHaveBeenCalledWith('PI');
    expect(page).toEqual({
      data: [{ ibge_code: '2211001', name: 'Teresina', uf: 'PI' }],
      pagination: { page: 2, page_size: 1, total: 2, total_pages: 2 },
    });
  });

  it('sem trecho, devolve a primeira página da lista inteira', async () => {
    const page = await new ListCitiesUseCase(repository).execute({
      uf: 'PI',
      page: 1,
      page_size: 20,
    });

    expect(page.data.map(({ name }) => name)).toEqual([
      'Acauã',
      'Tere',
      'Teresina',
    ]);
    expect(page.pagination.total).toBe(3);
  });

  it('confere o município na UF escolhida', async () => {
    const found = city(2211001, 'Teresina');

    repository.findCity.mockResolvedValue(found);

    await expect(
      new ResolveCityUseCase(repository).execute({
        ibgeCode: '2211001',
        uf: 'PI',
      }),
    ).resolves.toBe(found);
    expect(repository.findCity).toHaveBeenCalledWith(2211001, 'PI');
  });

  it('recusa um código de outra UF', async () => {
    repository.findCity.mockResolvedValue(null);

    await expect(
      new ResolveCityUseCase(repository).execute({
        ibgeCode: '3550308',
        uf: 'PI',
      }),
    ).rejects.toBeInstanceOf(CityNotInStateException);
  });
});
