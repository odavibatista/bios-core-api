import {
  EvidenceCategory,
  EvidenceSignal,
  EvidenceState,
} from '@prisma/client';
import type { EvidenceSourceConfig } from '@modules/data-sources/domain/dtos/providers/evidence-source.dto.js';
import type { StoredEvidence } from '@modules/evidences/domain/dtos/repositories/evidence.repository.js';
import { faker } from '../../support/faker.js';
import { defineFactory } from '../factory.js';
import { buildCnpj } from '../companies/company-profile.factory.js';

/** Fonte de evidências como o catálogo a descreve (categoria e ODS). */
export const evidenceSourceFactory = defineFactory<EvidenceSourceConfig>(
  () => ({
    id: faker.database.mongodbObjectId(),
    slug: faker.helpers.arrayElement(['IBAMA', 'CGU_CEIS', 'GHG_PROTOCOL']),
    category: faker.helpers.objectValue(EvidenceCategory),
    odsId: faker.database.mongodbObjectId(),
    odsNumber: faker.helpers.arrayElement([13, 15]),
  }),
);

/** Evidência guardada, com a fonte e o ODS em formato legível. */
export const storedEvidenceFactory = defineFactory<StoredEvidence>(() => {
  const cnpj = buildCnpj();
  const sourceSlug = 'IBAMA';
  const reference = faker.string.alphanumeric(8);

  return {
    id: faker.database.mongodbObjectId(),
    key: `${sourceSlug}:${cnpj}:${reference}`,
    cnpj,
    sourceSlug,
    sourceName: `IBAMA — ${faker.company.name()}`,
    category: EvidenceCategory.INFRACAO_AMBIENTAL,
    odsNumber: 15,
    state: EvidenceState.CONFIRMED,
    signal: EvidenceSignal.NEGATIVE,
    summary: faker.lorem.sentence(),
    sourceReference: reference,
    sourceUrl: faker.internet.url(),
    details: { valor: faker.number.int({ min: 1_000, max: 90_000 }) },
    publishedAt: faker.date.past(),
    collectedAt: faker.date.recent(),
    validUntil: faker.date.soon(),
    rawEvidenceId: null,
  };
});
