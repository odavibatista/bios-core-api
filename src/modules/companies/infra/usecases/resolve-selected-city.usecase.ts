import { Injectable } from '@nestjs/common';
import type { CityRecord } from '@modules/locations/domain/dtos/repositories/location.repository.js';
import { ResolveCityUseCase } from '@modules/locations/infra/usecases/resolve-city.usecase.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import type { CompanyAnalyticsQuery } from '../../domain/dtos/requests/search-companies.dto.js';

/**
 * Município escolhido nos critérios da pesquisa, da exportação ou do panorama (RF38).
 *
 * `undefined` quando o critério não veio. A validação da entrada garante a UF junto do código.
 *
 * @throws {CityNotInStateException} quando o código não é de um município da UF (422).
 */
@Injectable()
export class ResolveSelectedCityUseCase extends UseCase<
  Pick<CompanyAnalyticsQuery, 'uf' | 'city_ibge_code'>,
  CityRecord | undefined
> {
  constructor(private readonly resolveCity: ResolveCityUseCase) {
    super();
  }

  override async execute({
    uf,
    city_ibge_code: ibgeCode,
  }: Pick<CompanyAnalyticsQuery, 'uf' | 'city_ibge_code'>): Promise<
    CityRecord | undefined
  > {
    return ibgeCode === undefined || uf === undefined
      ? undefined
      : this.resolveCity.execute({ ibgeCode, uf });
  }
}
