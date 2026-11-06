import type { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import type { ViaCepDataSource } from '@modules/viacep/infra/providers/viacep.data-source.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import type { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import {
  PostalCodeLookupUnavailableException,
  PostalCodeNotFoundException,
} from '../../domain/dtos/errors/location.errors.js';
import type { LocationRepository } from '../../domain/dtos/repositories/location.repository.js';
import { LookupPostalCodeUseCase } from './lookup-postal-code.usecase.js';

const SOURCE = {
  postalCode: '23970000',
  street: null,
  neighborhood: null,
  city: 'Parati',
  state: 'RJ',
  cityIbgeCode: '3303807',
};
const KEY = { namespace: CacheNamespace.POSTAL_CODE, identifier: '23970000' };
const TTL = 2_592_000;

describe('LookupPostalCodeUseCase', () => {
  const viaCep = { fetch: vi.fn<ViaCepDataSource['fetch']>() };
  const locations = { findCity: vi.fn<LocationRepository['findCity']>() };
  const cache = { get: vi.fn(), set: vi.fn() };
  const ttl = { execute: vi.fn() };
  const useCase = new LookupPostalCodeUseCase(
    viaCep as unknown as ViaCepDataSource,
    locations as unknown as LocationRepository,
    cache as unknown as CacheProvider,
    ttl as unknown as ResolveSourceCacheTtlUseCase,
  );

  beforeEach(() => {
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue(undefined);
    ttl.execute.mockResolvedValue(TTL);
    viaCep.fetch.mockResolvedValue({ status: 'FOUND', data: SOURCE });
    locations.findCity.mockResolvedValue({
      ibgeCode: 3303807,
      name: 'Paraty',
      uf: 'RJ',
      searchName: 'PARATY',
      aliases: ['PARATI'],
    });
  });

  it('devolve o município com o nome do catálogo e guarda em cache', async () => {
    const address = {
      postal_code: '23970000',
      street: null,
      neighborhood: null,
      city: 'Paraty',
      city_ibge_code: '3303807',
      state: 'RJ',
    };

    await expect(useCase.execute('23970000')).resolves.toEqual(address);

    expect(locations.findCity).toHaveBeenCalledWith(3303807, 'RJ');
    expect(cache.set).toHaveBeenCalledWith(KEY, address, TTL);
  });

  it('responde do cache sem chamar a fonte', async () => {
    const address = {
      postal_code: '23970000',
      street: 'Rua A',
      neighborhood: 'Centro',
      city: 'Paraty',
      city_ibge_code: '3303807',
      state: 'RJ',
    };

    cache.get.mockResolvedValue(address);

    await expect(useCase.execute('23970000')).resolves.toEqual(address);
    expect(viaCep.fetch).not.toHaveBeenCalled();
  });

  it('município fora do catálogo volta com o nome da fonte e sem código', async () => {
    locations.findCity.mockResolvedValue(null);

    await expect(useCase.execute('23970000')).resolves.toMatchObject({
      city: 'Parati',
      city_ibge_code: null,
    });
  });

  it('sem código na fonte, nem consulta o catálogo', async () => {
    viaCep.fetch.mockResolvedValue({
      status: 'FOUND',
      data: { ...SOURCE, cityIbgeCode: null },
    });

    await expect(useCase.execute('23970000')).resolves.toMatchObject({
      city_ibge_code: null,
    });
    expect(locations.findCity).not.toHaveBeenCalled();
  });

  it('CEP inexistente responde 404 e não guarda nada', async () => {
    viaCep.fetch.mockResolvedValue({ status: 'NOT_FOUND' });

    await expect(useCase.execute('99999999')).rejects.toBeInstanceOf(
      PostalCodeNotFoundException,
    );
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('fonte fora do ar responde indisponível', async () => {
    viaCep.fetch.mockResolvedValue({
      status: 'UNAVAILABLE',
      reason: 'TIMEOUT',
    });

    await expect(useCase.execute('23970000')).rejects.toBeInstanceOf(
      PostalCodeLookupUnavailableException,
    );
  });
});
