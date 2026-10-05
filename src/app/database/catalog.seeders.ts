import { DataSourcesSeeder } from '@modules/data-sources/infra/db/seeders/data-sources.seeder.js';
import { BlockedEmailDomainsSeeder } from '@modules/security/infra/db/seeders/blocked-email-domains.seeder.js';
import { OdsSeeder } from '@modules/scoring/infra/db/seeders/ods.seeder.js';
import type { DatabaseSeeder } from '@shared/infra/database/database-seeder.js';

/**
 * Seeders dos catálogos de referência, na ordem de dependência: as fontes de
 * dados referenciam os ODS, então estes vêm primeiro.
 */
export const CATALOG_SEEDERS: readonly DatabaseSeeder[] = [
  new OdsSeeder(),
  new DataSourcesSeeder(),
  new BlockedEmailDomainsSeeder(),
];
