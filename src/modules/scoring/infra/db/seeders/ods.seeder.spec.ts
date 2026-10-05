import type { PrismaClient } from '@prisma/client';
import { odsFactory } from '@test/factories/scoring/ods.factory.js';
import { OdsSeeder, REFERENCE_ODS } from './ods.seeder.js';

describe('OdsSeeder', () => {
  it('cria ou atualiza os ODS 13 e 15 pelo número oficial, com os textos oficiais', async () => {
    const upsert = vi.fn(() => Promise.resolve(odsFactory.build()));
    const client = { ods: { upsert } } as unknown as PrismaClient;

    await new OdsSeeder().run(client);

    expect(REFERENCE_ODS.map(({ ods_number }) => ods_number)).toEqual([13, 15]);
    expect(upsert).toHaveBeenCalledTimes(REFERENCE_ODS.length);

    for (const { ods_number, title, description } of REFERENCE_ODS) {
      expect(upsert).toHaveBeenCalledWith({
        where: { ods_number },
        create: { ods_number, title, description },
        update: { title, description },
      });
    }
  });
});
