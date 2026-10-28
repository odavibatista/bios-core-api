import { createHash } from 'node:crypto';
import type { CadastralRecord } from '@modules/data-sources/domain/dtos/providers/cadastral-record.dto.js';
import { computeCadastralContentHash } from './cadastral-content-hash.js';

function buildRecord(
  overrides: Partial<CadastralRecord> = {},
): CadastralRecord {
  return {
    cnpj: '11222333000181',
    legalName: 'ACME LTDA',
    tradeName: 'ACME',
    registrationStatus: 'ATIVA',
    registrationStatusUnrecognized: null,
    companySize: 'DEMAIS',
    address: {
      street: 'AVENIDA PAULISTA',
      number: '1578',
      complement: 'ANDAR 12',
      neighborhood: 'BELA VISTA',
      city: 'SAO PAULO',
      cityIbgeCode: '3550308',
      uf: 'SP',
      zipcode: '01310200',
    },
    mainCnae: { code: '6201501', description: 'DESENVOLVIMENTO' },
    secondaryCnaes: [
      { code: '6202300', description: 'OUTRA' },
      { code: '6311900', description: 'DADOS' },
    ],
    ...overrides,
  };
}

describe('computeCadastralContentHash', () => {
  it('é um SHA-256 em hexadecimal', () => {
    expect(computeCadastralContentHash(buildRecord())).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('o mesmo cadastro resulta sempre no mesmo hash', () => {
    expect(computeCadastralContentHash(buildRecord())).toBe(
      computeCadastralContentHash(buildRecord()),
    );
  });

  describe('o que muda o hash: a empresa mudou', () => {
    const base = computeCadastralContentHash(buildRecord());

    it.each([
      ['a razão social', { legalName: 'ACME SA' }],
      ['o nome fantasia', { tradeName: 'OUTRA' }],
      ['a ausência do nome fantasia', { tradeName: null }],
      ['a situação cadastral', { registrationStatus: 'BAIXADA' as const }],
      [
        'uma situação fora do conjunto',
        {
          registrationStatus: 'NAO_RECONHECIDA' as const,
          registrationStatusUnrecognized: 'EM LIQUIDACAO',
        },
      ],
      ['o porte', { companySize: 'MICRO EMPRESA' }],
      [
        'o CNAE principal',
        { mainCnae: { code: '6202300', description: 'DESENVOLVIMENTO' } },
      ],
      [
        'a descrição do CNAE principal',
        { mainCnae: { code: '6201501', description: 'OUTRA DESCRIÇÃO' } },
      ],
      [
        'os CNAEs secundários',
        { secondaryCnaes: [{ code: '6202300', description: 'OUTRA' }] },
      ],
    ])('muda com %s', (_case, change) => {
      expect(computeCadastralContentHash(buildRecord(change))).not.toBe(base);
    });

    it.each([
      ['o logradouro', { street: 'RUA AUGUSTA' }],
      ['o número', { number: '10' }],
      ['o complemento', { complement: null }],
      ['o bairro', { neighborhood: 'CENTRO' }],
      ['o município', { city: 'CAMPINAS' }],
      ['a UF', { uf: 'RJ' }],
      ['o CEP', { zipcode: '01310300' }],
    ])('muda com %s do endereço', (_case, change) => {
      const record = buildRecord();

      expect(
        computeCadastralContentHash({
          ...record,
          address: { ...record.address, ...change },
        }),
      ).not.toBe(base);
    });
  });

  describe('o que não muda o hash: a empresa é a mesma', () => {
    const base = computeCadastralContentHash(buildRecord());

    it('o código IBGE do município, que só alguns provedores informam', () => {
      const record = buildRecord();

      expect(
        computeCadastralContentHash({
          ...record,
          address: { ...record.address, cityIbgeCode: null },
        }),
      ).toBe(base);
    });

    it('a ordem em que o provedor listou os CNAEs secundários', () => {
      const record = buildRecord();

      expect(
        computeCadastralContentHash({
          ...record,
          secondaryCnaes: [...record.secondaryCnaes].reverse(),
        }),
      ).toBe(base);
    });
  });

  describe('situação cadastral em conjunto fechado (#338)', () => {
    it('situações não reconhecidas diferentes dão hashes diferentes', () => {
      const unrecognized = (text: string) =>
        computeCadastralContentHash(
          buildRecord({
            registrationStatus: 'NAO_RECONHECIDA',
            registrationStatusUnrecognized: text,
          }),
        );

      expect(unrecognized('EM LIQUIDACAO')).not.toBe(
        unrecognized('EM RECUPERACAO'),
      );
    });

    it('cadastro com situação reconhecida mantém o hash de antes do conjunto fechado', () => {
      const record = buildRecord();
      const { address } = record;
      // Serialização anterior ao #338: a situação entrava como texto, na mesma posição.
      const before = createHash('sha256')
        .update(
          JSON.stringify([
            record.cnpj,
            record.legalName,
            record.tradeName,
            'ATIVA',
            record.companySize,
            [
              address.street,
              address.number,
              address.complement,
              address.neighborhood,
              address.city,
              address.uf,
              address.zipcode,
            ],
            [record.mainCnae.code, record.mainCnae.description],
            [
              ['6202300', 'OUTRA'],
              ['6311900', 'DADOS'],
            ],
          ]),
        )
        .digest('hex');

      expect(computeCadastralContentHash(record)).toBe(before);
    });
  });

  it('não confunde campos que se deslocam entre posições vizinhas', () => {
    const record = buildRecord();

    expect(
      computeCadastralContentHash({
        ...record,
        legalName: 'A',
        tradeName: 'B',
      }),
    ).not.toBe(
      computeCadastralContentHash({
        ...record,
        legalName: 'B',
        tradeName: 'A',
      }),
    );
  });
});
