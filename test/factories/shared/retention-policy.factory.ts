import type { RetentionPolicy } from '@shared/domain/dtos/providers/retention-policy.dto.js';
import { faker } from '../../support/faker.js';
import { defineFactory } from '../factory.js';
import { buildDuration } from './duration.factory.js';

/**
 * Política de retenção sobre uma coleção fictícia, com o índice nomeado pela
 * convenção `idx_<coleção>_<campo>`.
 */
export const retentionPolicyFactory = defineFactory<RetentionPolicy>(() => {
  const collection = faker.string.alpha({
    length: { min: 4, max: 12 },
    casing: 'lower',
  });
  const field = `${faker.string.alpha({ length: { min: 3, max: 10 }, casing: 'lower' })}_at`;

  return {
    collection,
    field,
    indexName: `idx_${collection}_${field}`,
    retention: buildDuration(),
  };
});
