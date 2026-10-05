import type { Ods, PrismaClient } from '@prisma/client';
import { dataSourceFactory } from '@test/factories/data-sources/data-source.factory.js';
import { odsFactory } from '@test/factories/scoring/ods.factory.js';
import { faker } from '@test/support/faker.js';
import { DATA_SOURCES, DataSourcesSeeder } from './data-sources.seeder.js';

function createClient(odsInDatabase: Ods[]) {
  const upsert = vi.fn(() => Promise.resolve(dataSourceFactory.build()));
  const client = {
    ods: { findMany: vi.fn().mockResolvedValue(odsInDatabase) },
    dataSource: { upsert },
  } as unknown as PrismaClient;

  return { client, upsert };
}

/** ODS 13 e 15 já gravados, com identificadores gerados pelo banco. */
function referenceOdsInDatabase(): Ods[] {
  return [13, 15].map((ods_number) => odsFactory.build({ ods_number }));
}

describe('DataSourcesSeeder', () => {
  it('cria as fontes sem sobrescrever as existentes, vinculando cada uma ao seu ODS', async () => {
    const odsInDatabase = referenceOdsInDatabase();
    const { client, upsert } = createClient(odsInDatabase);
    const { ods_number, ...source } = faker.helpers.arrayElement(
      DATA_SOURCES.filter((definition) => definition.ods_number !== undefined),
    );
    const linkedOds = odsInDatabase.find(
      (ods) => ods.ods_number === ods_number,
    );

    await new DataSourcesSeeder().run(client);

    expect(upsert).toHaveBeenCalledTimes(DATA_SOURCES.length);
    expect(upsert).toHaveBeenCalledWith({
      where: { slug: source.slug },
      create: { ...source, ods: { connect: { id_ods: linkedOds?.id_ods } } },
      update: {},
    });
  });

  it('cria as fontes sem ODS (cadastrais e de taxonomia) sem vínculo', async () => {
    const { client, upsert } = createClient(referenceOdsInDatabase());
    const source = faker.helpers.arrayElement(
      DATA_SOURCES.filter((definition) => definition.ods_number === undefined),
    );

    await new DataSourcesSeeder().run(client);

    expect(upsert).toHaveBeenCalledWith({
      where: { slug: source.slug },
      create: { ...source, ods: undefined },
      update: {},
    });
  });

  it('exige que os ODS tenham sido populados antes', async () => {
    const [missing, present] = faker.helpers.shuffle([13, 15]);
    const { client, upsert } = createClient([
      odsFactory.build({ ods_number: present }),
    ]);

    await expect(new DataSourcesSeeder().run(client)).rejects.toThrow(
      new RegExp(`ODS ${missing} ausente`),
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
