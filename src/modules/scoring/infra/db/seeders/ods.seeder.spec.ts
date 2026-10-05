import type { PrismaClient } from '@prisma/client';
import { OdsSeeder, REFERENCE_ODS } from './ods.seeder.js';

describe('OdsSeeder', () => {
  it('cria ou atualiza os ODS 13 e 15 pelo número oficial', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const client = { ods: { upsert } } as unknown as PrismaClient;

    await new OdsSeeder().run(client);

    expect(upsert).toHaveBeenCalledTimes(REFERENCE_ODS.length);
    expect(upsert).toHaveBeenCalledWith({
      where: { ods_number: 15 },
      create: expect.objectContaining({
        ods_number: 15,
        title: 'Vida Terrestre',
      }),
      update: expect.objectContaining({ title: 'Vida Terrestre' }),
    });
  });
});
