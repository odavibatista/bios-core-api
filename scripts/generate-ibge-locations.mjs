// Gera o catálogo de UFs e municípios a partir da API de localidades do IBGE (RF38).
//
// Uso: `node scripts/generate-ibge-locations.mjs`. O arquivo gerado é versionado: a API só roda
// aqui, nunca durante uma consulta. Rode de novo quando o IBGE criar ou renomear um município.
import { writeFile } from 'node:fs/promises';

const API = 'https://servicodados.ibge.gov.br/api/v1/localidades';
const OUTPUT = 'src/modules/locations/infra/db/seeders/ibge-locations.data.ts';
const EXPECTED_STATES = 27;
const MIN_EXPECTED_CITIES = 5_571;

async function read(path) {
  const response = await fetch(`${API}/${path}`, {
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) throw new Error(`IBGE respondeu ${response.status}.`);

  return response.json();
}

const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');

const states = (await read('estados'))
  .map(({ id, sigla, nome }) => ({ id, acronym: sigla, name: nome }))
  .sort(byName);
const cities = (await read('municipios?view=nivelado'))
  .map((row) => ({
    id: row['municipio-id'],
    name: row['municipio-nome'],
    stateId: row['UF-id'],
  }))
  .sort((a, b) => a.stateId - b.stateId || byName(a, b));

const stateIds = new Set(states.map(({ id }) => id));
const cityIds = new Set(cities.map(({ id }) => id));
const invalid = cities.filter(
  ({ id, name, stateId }) =>
    !/^\p{L}[\p{L}\p{M}' .-]*$/u.test(name) ||
    String(id).length !== 7 ||
    !stateIds.has(stateId),
);

if (states.length !== EXPECTED_STATES) {
  throw new Error(`Esperadas ${EXPECTED_STATES} UFs: vieram ${states.length}.`);
}

if (cities.length < MIN_EXPECTED_CITIES || cityIds.size !== cities.length) {
  throw new Error(`Lista de municípios suspeita: ${cities.length} linhas.`);
}

if (invalid.length > 0) {
  throw new Error(
    `Municípios inválidos: ${JSON.stringify(invalid.slice(0, 5))}`,
  );
}

const content = `// Gerado por scripts/generate-ibge-locations.mjs a partir da API de localidades do IBGE.
// Não editar à mão: sinônimos de grafia ficam em city-aliases.data.ts.

/** UF do IBGE. */
export interface IbgeStateRow {
  id: number;
  acronym: string;
  name: string;
}

/** Município do IBGE: código, nome oficial e código da UF. */
export type IbgeCityRow = readonly [id: number, name: string, stateId: number];

export const IBGE_STATES: readonly IbgeStateRow[] = ${JSON.stringify(states)};

export const IBGE_CITIES: readonly IbgeCityRow[] = ${JSON.stringify(
  cities.map(({ id, name, stateId }) => [id, name, stateId]),
)};
`;

await writeFile(OUTPUT, content);
console.log(`${states.length} UFs e ${cities.length} municípios em ${OUTPUT}.`);
