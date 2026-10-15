import { faker } from '@test/support/faker.js';
import { normalizeAddress, parseAddress, serializeAddress } from './address.js';
import type { Address } from './dtos/requests/address.dto.js';

function buildAddress(overrides: Partial<Address> = {}): Address {
  return {
    postal_code: '01310-100',
    street: faker.location.street(),
    number: faker.string.numeric(3),
    neighborhood: faker.location.county(),
    city: faker.location.city(),
    state: 'SP',
    ...overrides,
  };
}

describe('normalizeAddress', () => {
  it('guarda o CEP só com os dígitos', () => {
    expect(
      normalizeAddress(buildAddress({ postal_code: '01310-100' })).postal_code,
    ).toBe('01310100');
  });

  it('mantém o CEP que já vem só com dígitos', () => {
    expect(
      normalizeAddress(buildAddress({ postal_code: '01310100' })).postal_code,
    ).toBe('01310100');
  });

  it('remove espaços nas bordas dos textos', () => {
    const normalized = normalizeAddress(
      buildAddress({ street: '  Avenida Paulista ', city: ' São Paulo  ' }),
    );

    expect(normalized).toMatchObject({
      street: 'Avenida Paulista',
      city: 'São Paulo',
    });
  });

  it('omite o complemento vazio', () => {
    expect(
      normalizeAddress(buildAddress({ complement: '   ' })),
    ).not.toHaveProperty('complement');
  });

  it('mantém o complemento informado', () => {
    expect(
      normalizeAddress(buildAddress({ complement: ' Apto 12 ' })).complement,
    ).toBe('Apto 12');
  });

  it('a mesma entrada em formas diferentes dá o mesmo registro', () => {
    const base = buildAddress();

    expect(serializeAddress({ ...base, postal_code: '01310-100' })).toBe(
      serializeAddress({ ...base, postal_code: '01310100' }),
    );
  });
});

describe('serializeAddress e parseAddress', () => {
  it('fazem o caminho de ida e volta sem perder dado', () => {
    const address = buildAddress({ complement: 'Sala 4' });

    expect(parseAddress(serializeAddress(address))).toEqual(
      normalizeAddress(address),
    );
  });

  it('o texto serializado não traz o CEP com hífen', () => {
    expect(serializeAddress(buildAddress())).not.toContain('01310-100');
  });

  it.each([
    ['texto que não é JSON', 'isto não é JSON'],
    ['JSON que não é um endereço', '{"foo":"bar"}'],
    [
      'endereço com UF inválida',
      JSON.stringify({ ...buildAddress(), state: 'XX' }),
    ],
    [
      'endereço com CEP inválido',
      JSON.stringify({ ...buildAddress(), postal_code: '123' }),
    ],
  ])('recusa %s ao ler', (_case, serialized) => {
    expect(() => parseAddress(serialized)).toThrow();
  });
});
