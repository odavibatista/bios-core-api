import {
  CacheNamespace,
  type CacheKey,
} from '@shared/domain/dtos/providers/cache-key.dto.js';
import { faker } from '../../support/faker.js';
import { defineFactory } from '../factory.js';

/** CNPJ sem máscara, o identificador das entradas de empresa. */
export function buildCnpj(): string {
  return faker.string.numeric({ length: 14 });
}

/** Chave de cache em um namespace qualquer. */
export const cacheKeyFactory = defineFactory<CacheKey>(() => ({
  namespace: faker.helpers.objectValue(CacheNamespace),
  identifier: buildCnpj(),
}));

/** Valor guardado em cache, do formato de um perfil consolidado. */
export function buildCacheValue(): Record<string, unknown> {
  return {
    cnpj: buildCnpj(),
    corporate_name: faker.company.name(),
    city: faker.location.city(),
    updated_at: faker.date.recent().toISOString(),
  };
}

/** Janela de validade em segundos, da ordem das janelas reais (minutos a dias). */
export function buildTtlSeconds(): number {
  return faker.number.int({ min: 60, max: 30 * 86_400 });
}
