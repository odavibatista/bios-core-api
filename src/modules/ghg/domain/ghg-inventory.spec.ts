import {
  ghgEnvelope,
  ghgInventoryFactory,
} from '@test/factories/ghg/ghg.factory.js';
import { otherCguCnpj } from '@test/factories/cgu/cgu-sanction.factory.js';
import { faker } from '@test/support/faker.js';
import {
  candidateOrganizations,
  readInventories,
  readReportIdentity,
  ghgBaseUrl,
  toGhgEvidence,
  GhgInventorySchema,
} from './ghg-inventory.js';
import { ghgJobId } from './ghg-job.dto.js';
describe('contrato publico GHG', () => {
  const inventory = ghgInventoryFactory.build();
  it('valida e reduz inventario aos campos permitidos', () => {
    expect(
      GhgInventorySchema.parse({
        ...inventory,
        contact: faker.internet.email(),
      }),
    ).toEqual(inventory);
    expect(
      GhgInventorySchema.safeParse({ ...inventory, cnpj: '12345678909' })
        .success,
    ).toBe(false);
  });
  it('usa nome somente para candidatos limitados, ignorando acentos e caixa', () => {
    const orgs = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      name: 'Ação Climática',
    }));
    expect(
      candidateOrganizations(ghgEnvelope(orgs), ['ACAO CLIMATICA SA']),
    ).toHaveLength(3);
    expect(candidateOrganizations(ghgEnvelope(orgs), ['a'])).toEqual([]);
    expect(
      candidateOrganizations(ghgEnvelope([{ id: 1, name: 'ABC' }]), ['ABC SA']),
    ).toEqual([]);
  });
  it.each([
    null,
    [],
    { success: false },
    ghgEnvelope('<html>'),
    ghgEnvelope([{ id: 0, name: 'x' }]),
  ])('rejeita catalogo invalido %j', (body) => {
    expect(() => candidateOrganizations(body, ['Empresa'])).toThrow();
  });
  it('le inventarios e rejeita avisos/erros/inventarios fora do contrato', () => {
    const response = {
      inventories: [{ year: inventory.year, cycleId: inventory.cycleId }],
      errorMsg: null,
      warnMsg: null,
    };
    expect(readInventories(ghgEnvelope(response))).toEqual(
      response.inventories,
    );
    expect(() =>
      readInventories(
        ghgEnvelope({ ...response, errorMsg: faker.lorem.word() }),
      ),
    ).toThrow();
    expect(() =>
      readInventories(
        ghgEnvelope({ ...response, inventories: [{ year: 1900, cycleId: 1 }] }),
      ),
    ).toThrow();
  });
  it('extrai apenas rotulos de CNPJ e ano, incluindo separadores invisiveis', () => {
    expect(
      readReportIdentity(
        `Ano inventariado: ${inventory.year} CNPJ: ${inventory.cnpj} contato ${faker.internet.email()}`,
      ),
    ).toEqual({ cnpj: inventory.cnpj, year: inventory.year });
    expect(
      readReportIdentity(
        `Ano\u2060 inventariado: ${inventory.year} CNPJ: ${inventory.cnpj}`,
      ),
    ).not.toBeNull();
  });
  it.each([
    '',
    'CNPJ: 12345678909 Ano inventariado: 2025',
    'CNPJ: 11111111111111 Ano inventariado: 2025',
  ])('nao aceita identidade incompleta/invalida %s', (s) => {
    expect(readReportIdentity(s)).toBeNull();
  });
  it('rejeita anos e CNPJs ambiguos', () => {
    expect(
      readReportIdentity(`CNPJ: ${inventory.cnpj}XYZ Ano inventariado: 2025`),
    ).toBeNull();
    expect(
      readReportIdentity(
        `CNPJ: ${inventory.cnpj} CNPJ: ${otherCguCnpj(inventory.cnpj)} Ano inventariado: 2025`,
      ),
    ).toBeNull();
    expect(
      readReportIdentity(
        `CNPJ: ${inventory.cnpj} Ano inventariado: 2025 Ano inventariado: 2024`,
      ),
    ).toBeNull();
    expect(
      readReportIdentity(`CNPJ: ${inventory.cnpj} Ano inventariado: 1900`),
    ).toBeNull();
  });
  it('resolve hosts oficiais e preserva catalogo local de testes', () => {
    expect(ghgBaseUrl('https://registropublicodeemissoes.fgv.br')).toBe(
      'https://registropublicodeemissoesapi.fgv.br/',
    );
    expect(
      ghgBaseUrl('https://registropublicodeemissoesapi.fgv.br', true),
    ).toBe('https://sistema-registropublicodeemissoesapi.fgv.br/');
    expect(ghgBaseUrl('http://localhost:1234', true)).toBe(
      'http://localhost:1234/',
    );
  });
  it('mapeia referencia auditavel e ano sem inventar publicacao', () => {
    const entry = toGhgEvidence(inventory);
    expect(entry.raw).toEqual(inventory);
    expect(entry.finding).toMatchObject({
      reference: `${inventory.organizationId}/${inventory.cycleId}`,
      details: { inventoryYear: inventory.year },
      url: expect.stringContaining(
        `/${inventory.organizationId}/${inventory.cycleId}/true`,
      ),
    });
    expect(entry.finding.publishedAt).toBeUndefined();
  });
  it('deduplica por CNPJ/janela de quinze minutos', () => {
    expect(ghgJobId(inventory.cnpj, new Date(0))).toBe(
      ghgJobId(inventory.cnpj, new Date(899999)),
    );
    expect(ghgJobId(inventory.cnpj, new Date(900000))).not.toBe(
      ghgJobId(inventory.cnpj, new Date(0)),
    );
  });
});
