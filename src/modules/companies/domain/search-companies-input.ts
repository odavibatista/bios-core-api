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
 * que a tela mostra.
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
): SearchCompaniesInput {
  return {
    nameTerms: extractNameTerms(name ?? ''),
    uf,
    cityTerms: city === undefined ? undefined : extractNameTerms(city),
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
