import { CATALOG_SEEDERS } from './catalog.seeders.js';

describe('CATALOG_SEEDERS', () => {
  it('executa os ODS antes das fontes de dados, que dependem deles', () => {
    const names = CATALOG_SEEDERS.map(({ name }) => name);

    expect(names).toEqual(['ods', 'data-sources', 'blocked-email-domains']);
  });
});
