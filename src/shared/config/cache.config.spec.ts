import {
  buildCnpj,
  cacheKeyFactory,
} from '@test/factories/shared/cache-entry.factory.js';
import { faker } from '@test/support/faker.js';
import {
  CACHE_NAMESPACES,
  CacheNamespace,
} from '../domain/dtos/providers/cache-key.dto.js';
import {
  buildCacheKey,
  buildCacheKeysOf,
  CACHE_FORMAT_VERSION,
  CACHE_KEY_PREFIX,
} from './cache.config.js';

describe('chaves de cache', () => {
  it('compõe prefixo, versão do formato, namespace e identificador', () => {
    const identifier = buildCnpj();

    expect(
      buildCacheKey({
        namespace: CacheNamespace.COMPANY_PROFILE,
        identifier,
      }),
    ).toBe(
      `${CACHE_KEY_PREFIX}:v${CACHE_FORMAT_VERSION}:company-profile:${identifier}`,
    );
  });

  it('separa identificadores diferentes no mesmo namespace', () => {
    const [first, second] = faker.helpers.uniqueArray(buildCnpj, 2);
    const namespace = faker.helpers.objectValue(CacheNamespace);

    expect(buildCacheKey({ namespace, identifier: first })).not.toBe(
      buildCacheKey({ namespace, identifier: second }),
    );
  });

  it('separa namespaces diferentes no mesmo identificador', () => {
    const identifier = buildCnpj();

    const keys = CACHE_NAMESPACES.map((namespace) =>
      buildCacheKey({ namespace, identifier }),
    );

    expect(new Set(keys).size).toBe(CACHE_NAMESPACES.length);
  });

  it('carrega a versão do formato, que aposenta entradas antigas de uma vez', () => {
    const key = buildCacheKey(cacheKeyFactory.build());

    expect(key).toContain(`:v${CACHE_FORMAT_VERSION}:`);
  });

  it('reúne as chaves de um identificador em todos os namespaces', () => {
    const identifier = buildCnpj();

    const keys = buildCacheKeysOf(identifier);

    expect(keys).toHaveLength(CACHE_NAMESPACES.length);
    expect(keys.every((key) => key.endsWith(`:${identifier}`))).toBe(true);
  });
});
