import type { INestApplication } from '@nestjs/common';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { DATA_SOURCES } from '@modules/data-sources/infra/db/seeders/data-sources.seeder.js';
import { REFERENCE_ODS } from '@modules/scoring/infra/db/seeders/ods.seeder.js';
import { SEED_BLOCKED_EMAIL_DOMAINS } from '@modules/security/infra/db/seeders/blocked-email-domains.seeder.js';
import type { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';

describe.runIf(inject('databaseAvailable'))(
  'Seeders de catálogo com banco real (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
    });

    beforeEach(async () => {
      await prisma.reset();
    });

    afterAll(async () => {
      await app.close();
    });

    it('popula ODS, fontes de dados e blacklist de domínios', async () => {
      await prisma.seed(CATALOG_SEEDERS);

      expect(await prisma.ods.count()).toBe(REFERENCE_ODS.length);
      expect(await prisma.blockedEmailDomain.count()).toBe(
        SEED_BLOCKED_EMAIL_DOMAINS.length,
      );

      const sources = await prisma.dataSource.findMany({
        include: { ods: true },
      });
      const odsBySource = Object.fromEntries(
        sources.map(({ slug, ods }) => [slug, ods?.ods_number ?? null]),
      );

      expect(sources).toHaveLength(DATA_SOURCES.length);
      expect(odsBySource).toMatchObject({
        BRASIL_API: null,
        IBAMA: 15,
        CGU_CEIS: 15,
        CGU_CNEP: 15,
        GHG_PROTOCOL: 13,
      });
    });

    it('é idempotente e preserva ajustes feitos depois da carga inicial', async () => {
      await prisma.seed(CATALOG_SEEDERS);
      await prisma.dataSource.update({
        where: { slug: 'GHG_PROTOCOL' },
        data: { is_enabled: false },
      });

      await prisma.seed(CATALOG_SEEDERS);

      expect(await prisma.dataSource.count()).toBe(DATA_SOURCES.length);
      expect(
        await prisma.dataSource.findUniqueOrThrow({
          where: { slug: 'GHG_PROTOCOL' },
        }),
      ).toMatchObject({ is_enabled: false });
    });

    it('reset remove os documentos de todas as coleções', async () => {
      await prisma.seed(CATALOG_SEEDERS);

      await prisma.reset();

      expect(await prisma.ods.count()).toBe(0);
      expect(await prisma.dataSource.count()).toBe(0);
      expect(await prisma.blockedEmailDomain.count()).toBe(0);
    });
  },
);
