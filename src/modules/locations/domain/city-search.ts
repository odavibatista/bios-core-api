import type { CityRecord } from './dtos/repositories/location.repository.js';
import { toSearchName } from './location-names.js';

/** Posição do município na lista: quanto menor, mais perto do que foi digitado. */
const RANK_NAME_START = 0;
const RANK_WORD_START = 1;
const RANK_NAME_PART = 2;
const RANK_ALIAS = 3;

function rankOf(
  { searchName, aliases }: CityRecord,
  term: string,
): number | null {
  if (searchName.startsWith(term)) return RANK_NAME_START;

  if (searchName.includes(` ${term}`)) return RANK_WORD_START;

  if (searchName.includes(term)) return RANK_NAME_PART;

  return aliases.some((alias) => alias.includes(term)) ? RANK_ALIAS : null;
}

/**
 * Municípios cujo nome tem o trecho digitado (RF38, item c), sem distinguir acento nem caixa.
 *
 * Nome que começa pelo trecho vem antes do que só o contém, e uma grafia alternativa vem por
 * último, para `parati` ainda chegar a Paraty. Sem trecho, devolve todos, em ordem alfabética.
 */
export function searchCities(
  cities: readonly CityRecord[],
  search: string | undefined,
): CityRecord[] {
  const byName = (a: CityRecord, b: CityRecord) =>
    a.searchName.localeCompare(b.searchName);
  const term = toSearchName(search ?? '');

  if (term === '') return [...cities].sort(byName);

  return cities
    .flatMap((city) => {
      const rank = rankOf(city, term);

      return rank === null ? [] : [{ city, rank }];
    })
    .sort((a, b) => a.rank - b.rank || byName(a.city, b.city))
    .map(({ city }) => city);
}
