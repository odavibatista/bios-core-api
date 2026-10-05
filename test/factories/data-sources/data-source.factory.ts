import {
  type DataSource,
  DataSourceRole,
  EvidenceCategory,
  IngestionMode,
} from '@prisma/client';
import { faker } from '../../support/faker.js';
import { defineFactory, timestamps } from '../factory.js';

/**
 * Fonte externa de dados (`data_sources`). Os campos opcionais seguem o papel
 * sorteado: prioridade de fallback só para fontes cadastrais; categoria de
 * evidência e ODS só para fontes de evidência.
 */
export const dataSourceFactory = defineFactory<DataSource>(() => {
  const role = faker.helpers.objectValue(DataSourceRole);
  const name = faker.company.name();

  return {
    id_data_source: faker.database.mongodbObjectId(),
    slug: faker.helpers.slugify(name).replaceAll('-', '_').toUpperCase(),
    name,
    base_url: faker.internet.url(),
    role,
    ingestion_mode: faker.helpers.objectValue(IngestionMode),
    fallback_priority:
      role === DataSourceRole.CADASTRAL
        ? faker.number.int({ min: 1, max: 5 })
        : null,
    evidence_category:
      role === DataSourceRole.EVIDENCE
        ? faker.helpers.objectValue(EvidenceCategory)
        : null,
    ods_id:
      role === DataSourceRole.EVIDENCE
        ? faker.database.mongodbObjectId()
        : null,
    rate_limit_per_minute: faker.number.int({ min: 10, max: 600 }),
    cache_ttl_seconds: faker.number.int({ min: 60, max: 86_400 }),
    request_timeout_ms: faker.number.int({ min: 1_000, max: 30_000 }),
    is_enabled: true,
    ...timestamps(),
  };
});
