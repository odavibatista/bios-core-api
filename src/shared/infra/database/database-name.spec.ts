import { faker } from '@test/support/faker.js';
import { databaseNameOf, isDisposableDatabase } from './database-name.js';

describe('database-name', () => {
  const name = faker.string.alpha({
    length: { min: 3, max: 12 },
    casing: 'lower',
  });
  const host = faker.internet.domainName();

  it.each([
    [
      `mongodb://${host}:${faker.internet.port()}/${name}?directConnection=true`,
      name,
    ],
    [
      `mongodb+srv://${faker.internet.username()}:${faker.internet.password()}@${host}/${name}`,
      name,
    ],
    [`mongodb://${host}/${name}%2Dtest`, `${name}-test`],
  ])('extrai o nome do banco de %s', (url, expected) => {
    expect(databaseNameOf(url)).toBe(expected);
  });

  it.each([
    [`${name}_test`, true],
    [`${name}_e2e_test`, true],
    [name, false],
    [`${name}_testing`, false],
    ['_test', false],
  ])('%s é descartável? %s', (databaseName, disposable) => {
    expect(isDisposableDatabase(databaseName)).toBe(disposable);
  });
});
