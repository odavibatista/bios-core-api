/** UF, como o repositório a devolve. */
export interface StateRecord {
  ibgeCode: number;
  acronym: string;
  name: string;
}

/** Município, como o repositório o devolve. */
export interface CityRecord {
  ibgeCode: number;
  name: string;
  /** Sigla da UF. */
  uf: string;
  /** Nome normalizado (`toSearchName`). */
  searchName: string;
  /** Grafias alternativas, normalizadas. */
  aliases: string[];
}

/**
 * Catálogo de UFs e municípios do IBGE, somente leitura.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class LocationRepository {
  /** Todas as UFs, em ordem alfabética de nome. */
  abstract listStates(): Promise<StateRecord[]>;

  /** Todos os municípios da UF. Vazio: a sigla não existe no catálogo. */
  abstract listCities(uf: string): Promise<CityRecord[]>;

  /** O município de código e UF informados, ou `null`. */
  abstract findCity(ibgeCode: number, uf: string): Promise<CityRecord | null>;
}
