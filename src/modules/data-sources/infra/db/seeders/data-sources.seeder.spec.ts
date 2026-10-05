import type { PrismaClient } from '@prisma/client';
import { DATA_SOURCES, DataSourcesSeeder } from './data-sources.seeder.js';

function createClient(odsInDatabase: { id_ods: string; ods_number: number }[]) {
  const upsert = vi.fn().mockResolvedValue({});
  const client = {
    ods: { findMany: vi.fn().mockResolvedValue(odsInDatabase) },
    dataSource: { upsert },
  } as unknown as PrismaClient;

  return { client, upsert };
}

describe('DataSourcesSeeder', () => {
  it('cria as fontes sem sobrescrever as existentes, vinculando cada uma ao seu ODS', async () => {
    const { client, upsert } = createClient([
      { id_ods: 'ods-13', ods_number: 13 },
      { id_ods: 'ods-15', ods_number: 15 },
    ]);

    await new DataSourcesSeeder().run(client);

    expect(upsert).toHaveBeenCalledTimes(DATA_SOURCES.length);
    expect(upsert).toHaveBeenCalledWith({
      where: { slug: 'GHG_PROTOCOL' },
      create: expect.objectContaining({
        slug: 'GHG_PROTOCOL',
        ods: { connect: { id_ods: 'ods-13' } },
      }),
      update: {},
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'BRASIL_API' },
        create: expect.objectContaining({
          ods: undefined,
          fallback_priority: 1,
        }),
      }),
    );
  });

  it('exige que os ODS tenham sido populados antes', async () => {
    const { client, upsert } = createClient([
      { id_ods: 'ods-15', ods_number: 15 },
    ]);

    await expect(new DataSourcesSeeder().run(client)).rejects.toThrow(
      /ODS 13 ausente/,
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it('define a cadeia de fallback cadastral BrasilAPI → OpenCNPJ → Minha Receita', () => {
    const chain = DATA_SOURCES.filter(
      ({ fallback_priority }) => fallback_priority,
    )
      .sort((a, b) => (a.fallback_priority ?? 0) - (b.fallback_priority ?? 0))
      .map(({ slug }) => slug);

    expect(chain).toEqual(['BRASIL_API', 'OPEN_CNPJ', 'MINHA_RECEITA']);
  });
});
