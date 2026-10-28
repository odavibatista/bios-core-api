import { faker } from '@test/support/faker.js';
import { cnpjWithCheckDigits, formatCnpj, parseCnpj } from './cnpj.js';

describe('cnpjWithCheckDigits (dados sintéticos, RF21)', () => {
  it.each([
    ['112223330001', '11222333000181'],
    ['330001670001', '33000167000101'],
    ['12ABC34501DE', '12ABC34501DE35'],
  ])('completa %s com os dígitos verificadores: %s', (base, expected) => {
    expect(cnpjWithCheckDigits(base)).toBe(expected);
  });

  it('todo CNPJ gerado passa na validação', () => {
    for (let index = 0; index < 50; index += 1) {
      const cnpj = cnpjWithCheckDigits(`${faker.string.numeric(8)}0001`);

      expect(parseCnpj(cnpj)).toBe(cnpj);
    }
  });

  it.each(['11222333000', '1122233300011', '11222333000a', ''])(
    'recusa a base %j, que não tem 12 posições alfanuméricas maiúsculas',
    (base) => {
      expect(() => cnpjWithCheckDigits(base)).toThrow(/12 posições/);
    },
  );
});

/** CNPJs numéricos reais, de domínio público. */
const VALID_NUMERIC = [
  '11222333000181',
  '00000000000191', // Banco do Brasil
  '33000167000101', // Petrobras
  '60746948000112', // Bradesco
];

/** Exemplo oficial da Receita Federal para o CNPJ alfanumérico. */
const OFFICIAL_ALPHANUMERIC = '12ABC34501DE35';

describe('parseCnpj', () => {
  it.each(VALID_NUMERIC)('aceita o CNPJ numérico %s', (cnpj) => {
    expect(parseCnpj(cnpj)).toBe(cnpj);
  });

  it('aceita o exemplo oficial do CNPJ alfanumérico', () => {
    expect(parseCnpj(OFFICIAL_ALPHANUMERIC)).toBe(OFFICIAL_ALPHANUMERIC);
  });

  it('aceita o CNPJ com máscara e devolve a forma canônica', () => {
    expect(parseCnpj('11.222.333/0001-81')).toBe('11222333000181');
    expect(parseCnpj('12.ABC.345/01DE-35')).toBe(OFFICIAL_ALPHANUMERIC);
  });

  it('aceita letras minúsculas no CNPJ alfanumérico e devolve em maiúsculas', () => {
    expect(parseCnpj('12abc34501de35')).toBe(OFFICIAL_ALPHANUMERIC);
  });

  it('ignora espaços nas bordas', () => {
    expect(parseCnpj('  11222333000181 ')).toBe('11222333000181');
  });

  it.each(VALID_NUMERIC)(
    'recusa o CNPJ %s com o último dígito trocado',
    (cnpj) => {
      const last = Number(cnpj.at(-1));
      const wrong = `${cnpj.slice(0, 13)}${(last + 1) % 10}`;

      expect(parseCnpj(wrong)).toBeNull();
    },
  );

  it.each(VALID_NUMERIC)(
    'recusa o CNPJ %s com o penúltimo dígito trocado',
    (cnpj) => {
      const penultimate = Number(cnpj.at(-2));
      const wrong = `${cnpj.slice(0, 12)}${(penultimate + 1) % 10}${cnpj.at(-1)}`;

      expect(parseCnpj(wrong)).toBeNull();
    },
  );

  it('recusa o CNPJ alfanumérico com um caractere da raiz trocado', () => {
    expect(parseCnpj('12ABD34501DE35')).toBeNull();
  });

  it.each([
    '00000000000000',
    '11111111111111',
    '99999999999999',
    'AAAAAAAAAAAA00',
  ])('recusa a sequência de um caractere só %s', (cnpj) => {
    expect(parseCnpj(cnpj)).toBeNull();
  });

  it.each([
    ['vazio', ''],
    ['só pontuação', './-'],
    ['curto demais', '1122233300018'],
    ['longo demais', '112223330001811'],
    ['com letra nos dígitos verificadores', '1122233300018A'],
    ['com caractere fora do alfabeto', '1122233300018!'],
    ['com acento', '11222333000ÁB1'],
    ['um CPF', '52998224725'],
  ])('recusa texto %s', (_case, text) => {
    expect(parseCnpj(text)).toBeNull();
  });

  it('o resultado é o mesmo para o mesmo CNPJ escrito de jeitos diferentes', () => {
    const forms = ['11222333000181', '11.222.333/0001-81', ' 11222333000181 '];

    expect(new Set(forms.map(parseCnpj)).size).toBe(1);
  });

  it('não aceita um CNPJ sorteado ao acaso: o dígito verificador filtra', () => {
    const accepted = Array.from({ length: 200 }, () =>
      parseCnpj(faker.string.numeric({ length: 14, allowLeadingZeros: true })),
    ).filter(Boolean);

    // 1 em 100 passa por acaso; 200 sorteios não podem aceitar a maioria.
    expect(accepted.length).toBeLessThan(20);
  });
});

describe('formatCnpj', () => {
  it('aplica a máscara ao CNPJ numérico', () => {
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('aplica a máscara ao CNPJ alfanumérico', () => {
    expect(formatCnpj(OFFICIAL_ALPHANUMERIC)).toBe('12.ABC.345/01DE-35');
  });

  it('é o inverso de parseCnpj', () => {
    for (const cnpj of [...VALID_NUMERIC, OFFICIAL_ALPHANUMERIC]) {
      expect(parseCnpj(formatCnpj(cnpj))).toBe(cnpj);
    }
  });
});
