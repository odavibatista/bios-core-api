import type { PrismaClient } from '@prisma/client';
import { DatabaseSeeder } from '@shared/infra/database/database-seeder.js';
import { toSearchName } from '../../../domain/location-names.js';
import { CITY_ALIASES } from './city-aliases.data.js';
import { IBGE_CITIES, IBGE_STATES } from './ibge-locations.data.js';

/** Maior lote de uma gravação: o catálogo tem milhares de linhas. */
const WRITE_BATCH = 1_000;

interface StateRow {
  id_ibge_state: number;
  acronym: string;
  name: string;
}

interface CityRow {
  id_ibge_city: number;
  ibge_state_id: number;
  name: string;
  search_name: string;
  aliases: string[];
}

/** O que falta para o banco ficar igual ao catálogo, sem gravar nada. */
export interface LocationsDiff {
  states: { create: StateRow[]; update: StateRow[]; unchanged: number };
  cities: { create: CityRow[]; update: CityRow[]; unchanged: number };
}

export function desiredStates(): StateRow[] {
  return IBGE_STATES.map(({ id, acronym, name }) => ({
    id_ibge_state: id,
    acronym,
    name,
  }));
}

export function desiredCities(): CityRow[] {
  return IBGE_CITIES.map(([id, name, stateId]) => ({
    id_ibge_city: id,
    ibge_state_id: stateId,
    name,
    search_name: toSearchName(name),
    aliases: (CITY_ALIASES[id] ?? []).map(toSearchName),
  }));
}

function compare<TRow extends object>(
  desired: readonly TRow[],
  current: readonly TRow[],
  idOf: (row: TRow) => number,
): { create: TRow[]; update: TRow[]; unchanged: number } {
  const known = new Map(current.map((row) => [idOf(row), row]));
  const result = { create: [] as TRow[], update: [] as TRow[], unchanged: 0 };

  for (const row of desired) {
    const existing = known.get(idOf(row));

    if (!existing) result.create.push(row);
    else if (
      Object.entries(row).some(
        ([field, value]) =>
          JSON.stringify(value) !==
          JSON.stringify(existing[field as keyof TRow]),
      )
    ) {
      result.update.push(row);
    } else result.unchanged += 1;
  }

  return result;
}

/** Compara o catálogo do código com o banco. */
export async function diffLocations(
  client: PrismaClient,
): Promise<LocationsDiff> {
  const [states, cities] = await Promise.all([
    client.ibgeState.findMany(),
    client.ibgeCity.findMany(),
  ]);

  return {
    states: compare(desiredStates(), states, (row) => row.id_ibge_state),
    cities: compare(desiredCities(), cities, (row) => row.id_ibge_city),
  };
}

/**
 * Popula `ibge_states` e `ibge_cities`. Os nomes são oficiais e, por isso, reaplicados a
 * cada execução. Lê tudo uma vez e só grava o que difere: rodar de novo não custa milhares de
 * escritas.
 */
export class LocationsSeeder extends DatabaseSeeder {
  override readonly name = 'locations';

  override async run(client: PrismaClient): Promise<void> {
    const { states, cities } = await diffLocations(client);

    if (states.create.length > 0) {
      await client.ibgeState.createMany({ data: states.create });
    }

    for (const { id_ibge_state, ...data } of states.update) {
      await client.ibgeState.update({ where: { id_ibge_state }, data });
    }

    for (let start = 0; start < cities.create.length; start += WRITE_BATCH) {
      await client.ibgeCity.createMany({
        data: cities.create.slice(start, start + WRITE_BATCH),
      });
    }

    for (const { id_ibge_city, ...data } of cities.update) {
      await client.ibgeCity.update({ where: { id_ibge_city }, data });
    }
  }
}
