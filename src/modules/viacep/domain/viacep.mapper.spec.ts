import { normalizePostalCode, readPostalAddress } from './viacep.mapper.js';

const RESPONSE = {
  cep: '01310-200',
  logradouro: 'Avenida Paulista',
  complemento: 'de 1047 a 1865 - lado ímpar',
  unidade: '',
  bairro: 'Bela Vista',
  localidade: 'São Paulo',
  uf: 'SP',
  estado: 'São Paulo',
  regiao: 'Sudeste',
  ibge: '3550308',
  gia: '1004',
  ddd: '11',
  siafi: '7107',
};

describe('normalizePostalCode', () => {
  it.each([
    ['01310-200', '01310200'],
    ['01310200', '01310200'],
    [' 01310200 ', '01310200'],
  ])('%s vira %s', (value, expected) => {
    expect(normalizePostalCode(value)).toBe(expected);
  });

  it.each(['', '1234567', '123456789', '01310-20a', '013.10-200'])(
    'recusa %s',
    (value) => {
      expect(normalizePostalCode(value)).toBeNull();
    },
  );
});

describe('readPostalAddress', () => {
  it('lê o endereço e não leva número nem complemento', () => {
    expect(readPostalAddress(RESPONSE, '01310200')).toEqual({
      kind: 'FOUND',
      value: {
        postalCode: '01310200',
        street: 'Avenida Paulista',
        neighborhood: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
        cityIbgeCode: '3550308',
      },
    });
  });

  it('CEP geral de município vem sem logradouro nem bairro', () => {
    const lookup = readPostalAddress(
      { ...RESPONSE, logradouro: '', bairro: '' },
      '01310200',
    );

    expect(lookup).toMatchObject({
      kind: 'FOUND',
      value: { street: null, neighborhood: null },
    });
  });

  it.each([
    ['fora do formato', '35'],
    ['ausente', undefined],
  ])('código IBGE %s não derruba o endereço', (_case, ibge) => {
    expect(readPostalAddress({ ...RESPONSE, ibge }, '01310200')).toMatchObject({
      kind: 'FOUND',
      value: { cityIbgeCode: null },
    });
  });

  it.each([[{ erro: true }], [{ erro: 'true' }]])(
    'entende %j como CEP inexistente',
    (body) => {
      expect(readPostalAddress(body, '01310200')).toEqual({ kind: 'ABSENT' });
    },
  );

  it.each([
    ['outro CEP', { ...RESPONSE, cep: '20040-020' }],
    ['sem município', { ...RESPONSE, localidade: '  ' }],
    ['UF fora do formato', { ...RESPONSE, uf: 'sp' }],
    ['corpo sem campos', {}],
    ['corpo que não é objeto', 'erro'],
  ])('recusa %s', (_case, body) => {
    expect(readPostalAddress(body, '01310200')).toEqual({ kind: 'INVALID' });
  });
});
