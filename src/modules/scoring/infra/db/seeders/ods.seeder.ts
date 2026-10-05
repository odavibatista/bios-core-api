import type { PrismaClient } from '@prisma/client';
import { DatabaseSeeder } from '@shared/infra/database/database-seeder.js';

/**
 * ODS de referência do MVP, com título e descrição oficiais da Agenda 2030.
 */
export const REFERENCE_ODS = [
  {
    ods_number: 13,
    title: 'Ação Contra a Mudança Global do Clima',
    description:
      'Tomar medidas urgentes para combater a mudança do clima e seus impactos.',
  },
  {
    ods_number: 15,
    title: 'Vida Terrestre',
    description:
      'Proteger, recuperar e promover o uso sustentável dos ecossistemas terrestres, ' +
      'gerir de forma sustentável as florestas, combater a desertificação, deter e ' +
      'reverter a degradação da terra e deter a perda de biodiversidade.',
  },
] as const;

/**
 * Popula a coleção `ods`. Título e descrição são oficiais e, por isso,
 * reaplicados a cada execução.
 */
export class OdsSeeder extends DatabaseSeeder {
  override readonly name = 'ods';

  override async run(client: PrismaClient): Promise<void> {
    for (const { ods_number, title, description } of REFERENCE_ODS) {
      await client.ods.upsert({
        where: { ods_number },
        create: { ods_number, title, description },
        update: { title, description },
      });
    }
  }
}
