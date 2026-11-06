import { toSearchName } from '../../../domain/location-names.js';
import { CITY_ALIASES } from './city-aliases.data.js';
import { IBGE_CITIES, IBGE_STATES } from './ibge-locations.data.js';

describe('catálogo de localidades', () => {
  const stateIds = new Set(IBGE_STATES.map(({ id }) => id));
  const cityIds = new Set(IBGE_CITIES.map(([id]) => id));

  it('tem as 27 UFs e os 5.571 municípios do IBGE, sem repetição', () => {
    expect(IBGE_STATES).toHaveLength(27);
    expect(IBGE_CITIES).toHaveLength(5_571);
    expect(cityIds.size).toBe(IBGE_CITIES.length);
    expect(new Set(IBGE_STATES.map(({ acronym }) => acronym)).size).toBe(27);
  });

  it('todo município tem código de 7 dígitos, começando pela UF', () => {
    for (const [id, , stateId] of IBGE_CITIES) {
      expect(String(id)).toMatch(/^\d{7}$/);
      expect(stateIds.has(stateId)).toBe(true);
      expect(String(id).startsWith(String(stateId))).toBe(true);
    }
  });

  it('nenhum nome vem corrompido', () => {
    const invalid = IBGE_CITIES.filter(
      ([, name]) =>
        !/^\p{L}[\p{L}\p{M}' .-]*$/u.test(name) || name.includes('_'),
    );

    expect(invalid).toEqual([]);
  });

  it('nenhum nome se repete dentro da mesma UF', () => {
    const keys = IBGE_CITIES.map(
      ([, name, stateId]) => `${stateId}|${toSearchName(name)}`,
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('todo sinônimo aponta para um município que existe e não colide com outro da UF', () => {
    const names = new Set(
      IBGE_CITIES.map(
        ([, name, stateId]) => `${stateId}|${toSearchName(name)}`,
      ),
    );
    const stateOf = new Map(
      IBGE_CITIES.map(([id, , stateId]) => [id, stateId]),
    );

    for (const [id, aliases] of Object.entries(CITY_ALIASES)) {
      expect(cityIds.has(Number(id))).toBe(true);

      for (const alias of aliases) {
        expect(
          names.has(`${stateOf.get(Number(id))}|${toSearchName(alias)}`),
        ).toBe(false);
      }
    }
  });
});
