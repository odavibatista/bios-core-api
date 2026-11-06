import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  type CityRecord,
  LocationRepository,
  type StateRecord,
} from '../../../domain/dtos/repositories/location.repository.js';

function toCity(
  row: {
    id_ibge_city: number;
    name: string;
    search_name: string;
    aliases: string[];
  },
  uf: string,
): CityRecord {
  return {
    ibgeCode: row.id_ibge_city,
    name: row.name,
    uf,
    searchName: row.search_name,
    aliases: row.aliases,
  };
}

@Injectable()
export class PrismaLocationRepository
  extends PrismaRepository
  implements LocationRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async listStates(): Promise<StateRecord[]> {
    const rows = await this.prisma.ibgeState.findMany({
      orderBy: { name: 'asc' },
    });

    return rows.map(({ id_ibge_state, acronym, name }) => ({
      ibgeCode: id_ibge_state,
      acronym,
      name,
    }));
  }

  async listCities(uf: string): Promise<CityRecord[]> {
    const state = await this.findState(uf);

    if (!state) return [];

    const rows = await this.prisma.ibgeCity.findMany({
      where: { ibge_state_id: state.id_ibge_state },
    });

    return rows.map((row) => toCity(row, uf));
  }

  async findCity(ibgeCode: number, uf: string): Promise<CityRecord | null> {
    const state = await this.findState(uf);

    if (!state) return null;

    const row = await this.prisma.ibgeCity.findFirst({
      where: { id_ibge_city: ibgeCode, ibge_state_id: state.id_ibge_state },
    });

    return row ? toCity(row, uf) : null;
  }

  private findState(uf: string): Promise<{ id_ibge_state: number } | null> {
    return this.prisma.ibgeState.findUnique({
      where: { acronym: uf },
      select: { id_ibge_state: true },
    });
  }
}
