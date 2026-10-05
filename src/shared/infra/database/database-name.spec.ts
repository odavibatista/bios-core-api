import { databaseNameOf, isDisposableDatabase } from './database-name.js';

describe('database-name', () => {
  it.each([
    ['mongodb://localhost:27017/bios_test?directConnection=true', 'bios_test'],
    ['mongodb+srv://user:pass@cluster.example.net/bios', 'bios'],
    ['mongodb://localhost:27017/bios%2Dtest', 'bios-test'],
  ])('extrai o nome do banco de %s', (url, name) => {
    expect(databaseNameOf(url)).toBe(name);
  });

  it.each([
    ['bios_test', true],
    ['bios_e2e_test', true],
    ['bios', false],
    ['bios_testing', false],
    ['_test', false],
  ])('%s é descartável? %s', (name, disposable) => {
    expect(isDisposableDatabase(name)).toBe(disposable);
  });
});
