import { IngestionRunStatus } from '@prisma/client';
import type { IngestionRunRecord } from '@modules/data-sources/domain/dtos/repositories/ingestion-run.repository.js';
import { faker } from '../../support/faker.js';
import { defineFactory } from '../factory.js';

/** Execução de ingestão como o repositório a entrega. */
export const ingestionRunFactory = defineFactory<IngestionRunRecord>(() => {
  const startedAt = faker.date.recent();

  return {
    id: faker.database.mongodbObjectId(),
    dataSourceId: faker.database.mongodbObjectId(),
    status: IngestionRunStatus.SUCCEEDED,
    dumpChecksum: buildChecksum(),
    startedAt,
    finishedAt: faker.date.soon({ refDate: startedAt }),
  };
});

/** SHA-256 em hexadecimal, no formato que o download de dumps entrega. */
export function buildChecksum(): string {
  return faker.string.hexadecimal({
    length: 64,
    casing: 'lower',
    prefix: '',
  });
}
