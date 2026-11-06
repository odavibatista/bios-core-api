import type { CityRecord } from '@modules/locations/domain/dtos/repositories/location.repository.js';
import { extractNameTerms } from './company-name-terms.js';
import type { SearchCompaniesInput } from './dtos/repositories/company-profile.repository.js';
import type { ExportCompaniesQuery } from './dtos/requests/search-companies.dto.js';

/** Janela de resultados da pesquisa. */
export interface SearchWindow {
  skip: number;
  take: number;
}

/**
 * Traduz os critérios validados da pesquisa para o que o repositório entende: palavras
 * normalizadas do nome e do município, e o ODS com seus mínimos e a ordenação.
 *
 * A pesquisa paginada e a exportação usam a mesma tradução, para a lista exportada ser a
 * que a tela mostra. `selectedCity` é o município já resolvido de `city_ibge_code`, com o nome
 * oficial e as grafias de outras fontes: o cadastro guarda o nome como a fonte escreveu.
 */
export function toSearchInput(
  {
    name,
    uf,
    city,
    cnae,
    ods,
    min_score,
    min_confidence,
    order,
  }: ExportCompaniesQuery,
  window: SearchWindow,
  selectedCity?: CityRecord,
): SearchCompaniesInput {
  const cityName = selectedCity?.name ?? city;

  return {
    nameTerms: extractNameTerms(name ?? ''),
    uf,
    cityTerms: cityName === undefined ? undefined : extractNameTerms(cityName),
    cityAliases: selectedCity?.aliases.map(extractNameTerms),
    cnaePrefix: cnae,
    ods:
      ods === undefined
        ? undefined
        : {
            number: ods,
            minScore: min_score,
            minConfidence: min_confidence,
            order,
          },
    ...window,
  };
}
