import type { CityRecord } from '@modules/locations/domain/dtos/repositories/location.repository.js';
import type { ResolveCityUseCase } from '@modules/locations/infra/usecases/resolve-city.usecase.js';
import { ResolveSelectedCityUseCase } from './resolve-selected-city.usecase.js';

describe('ResolveSelectedCityUseCase', () => {
  const city: CityRecord = {
    ibgeCode: 3303807,
    name: 'Paraty',
    uf: 'RJ',
    searchName: 'PARATY',
    aliases: ['PARATI'],
  };
  const resolveCity = { execute: vi.fn<ResolveCityUseCase['execute']>() };
  const useCase = new ResolveSelectedCityUseCase(
    resolveCity as unknown as ResolveCityUseCase,
  );

  beforeEach(() => {
    resolveCity.execute.mockResolvedValue(city);
  });

  it('sem código, não consulta o catálogo', async () => {
    await expect(useCase.execute({ uf: 'RJ' })).resolves.toBeUndefined();

    expect(resolveCity.execute).not.toHaveBeenCalled();
  });

  it('com código e UF, devolve o município do catálogo', async () => {
    await expect(
      useCase.execute({ uf: 'RJ', city_ibge_code: '3303807' }),
    ).resolves.toBe(city);

    expect(resolveCity.execute).toHaveBeenCalledWith({
      ibgeCode: '3303807',
      uf: 'RJ',
    });
  });
});
