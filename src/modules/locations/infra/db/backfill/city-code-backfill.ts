import type { PrismaClient } from '@prisma/client';
import { toSearchName } from '../../../domain/location-names.js';

/** Maior número de atualizações num único comando ao banco. */
const UPDATE_BATCH = 200;

/** Cadastros de um mesmo local sem código IBGE. */
export interface CityCodeGap {
  uf: string;
  city: string;
  companies: number;
  /** Código do município no catálogo. `null`: o local não está no catálogo. */
  ibgeCode: string | null;
}

interface GapRow {
  _id: { uf?: string | null; city?: string | null };
  companies: number;
}

/**
 * Preenche `address.city_ibge_code` nos cadastros que ainda não o têm (RF38), sob comando
 * explícito. Agrupa por UF e município para fazer uma atualização por local, e não uma por
 * empresa. Cadastro que já tem código nunca é alterado.
 */
export class CityCodeBackfill {
  /** Lê os locais sem código e procura cada um no catálogo, sem gravar nada. */
  async plan(client: PrismaClient): Promise<CityCodeGap[]> {
    const [codes, rows] = await Promise.all([
      this.catalogCodes(client),
      client.companyProfile.aggregateRaw({
        pipeline: [
          { $match: { 'address.city_ibge_code': null } },
          {
            $group: {
              _id: { uf: '$address.uf', city: '$address.city' },
              companies: { $sum: 1 },
            },
          },
        ],
      }),
    ]);

    return (rows as unknown as GapRow[]).map(({ _id, companies }) => {
      const uf = _id.uf ?? '';
      const city = _id.city ?? '';

      return {
        uf,
        city,
        companies,
        ibgeCode: codes.get(`${uf}|${toSearchName(city)}`) ?? null,
      };
    });
  }

  /** Grava os locais encontrados e devolve quantos cadastros mudaram. */
  async apply(
    client: PrismaClient,
    gaps: readonly CityCodeGap[],
  ): Promise<number> {
    const known = gaps.filter(({ ibgeCode }) => ibgeCode !== null);
    let updated = 0;

    for (let start = 0; start < known.length; start += UPDATE_BATCH) {
      const result = await client.$runCommandRaw({
        update: 'company_profile',
        updates: known.slice(start, start + UPDATE_BATCH).map((gap) => ({
          q: {
            'address.uf': gap.uf,
            'address.city': gap.city,
            'address.city_ibge_code': null,
          },
          u: { $set: { 'address.city_ibge_code': gap.ibgeCode } },
          multi: true,
        })),
      });

      updated += Number(result.nModified ?? 0);
    }

    return updated;
  }

  /** Nome oficial e grafias de cada município, por UF. */
  private async catalogCodes(
    client: PrismaClient,
  ): Promise<Map<string, string>> {
    const [states, cities] = await Promise.all([
      client.ibgeState.findMany(),
      client.ibgeCity.findMany(),
    ]);
    const acronyms = new Map(
      states.map(({ id_ibge_state, acronym }) => [id_ibge_state, acronym]),
    );

    return new Map(
      cities.flatMap(({ id_ibge_city, ibge_state_id, search_name, aliases }) =>
        [search_name, ...aliases].map(
          (name) =>
            [
              `${acronyms.get(ibge_state_id) ?? ''}|${name}`,
              String(id_ibge_city),
            ] as const,
        ),
      ),
    );
  }
}
