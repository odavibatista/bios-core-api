import { Injectable } from '@nestjs/common';
import { buildPaginationMeta } from '@shared/domain/dtos/requests/pagination.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { searchCities } from '../../domain/city-search.js';
import { LocationRepository } from '../../domain/dtos/repositories/location.repository.js';
import type {
  IbgeCityListResponse,
  ListCitiesQuery,
  StateParam,
} from '../../domain/dtos/requests/location.dto.js';

/** UF e busca do seletor de município. */
export type ListCitiesCommand = StateParam & ListCitiesQuery;

/**
 * Municípios de uma UF, filtrados pelo trecho digitado (UC05, UC08, RF38).
 *
 * A UF tem no máximo 853 municípios: ordenar em memória custa pouco, e a ordem por
 * proximidade com o que foi digitado não caberia numa consulta simples ao banco.
 */
@Injectable()
export class ListCitiesUseCase extends UseCase<
  ListCitiesCommand,
  IbgeCityListResponse
> {
  constructor(private readonly locations: LocationRepository) {
    super();
  }

  override async execute({
    uf,
    search,
    page,
    page_size,
  }: ListCitiesCommand): Promise<IbgeCityListResponse> {
    const cities = searchCities(await this.locations.listCities(uf), search);
    const start = (page - 1) * page_size;

    return {
      data: cities.slice(start, start + page_size).map((city) => ({
        ibge_code: String(city.ibgeCode),
        name: city.name,
        uf: city.uf,
      })),
      pagination: buildPaginationMeta({ page, page_size }, cities.length),
    };
  }
}
