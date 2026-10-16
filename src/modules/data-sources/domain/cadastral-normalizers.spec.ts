import {
  cleanText,
  cleanUpperText,
  joinStreet,
  normalizeCnaeCode,
  normalizeIbgeCode,
  normalizeRegistrationStatus,
  normalizeUf,
  normalizeZipcode,
} from './cadastral-normalizers.js';

describe('normalizadores cadastrais', () => {
  describe('cleanText', () => {
    it.each([
      ['  ACME  ', 'ACME'],
      ['Av. Paulista', 'Av. Paulista'],
      [1578, '1578'],
      [0, '0'],
    ])('devolve %j como %j', (value, expected) => {
      expect(cleanText(value)).toBe(expected);
    });

    it.each([[''], ['   '], [null], [undefined]])(
      'trata %j como ausente',
      (value) => {
        expect(cleanText(value)).toBeNull();
      },
    );
  });

  describe('cleanUpperText', () => {
    it('limpa e põe em maiúsculas', () => {
      expect(cleanUpperText('  micro empresa ')).toBe('MICRO EMPRESA');
    });

    it('preserva a ausência', () => {
      expect(cleanUpperText('  ')).toBeNull();
      expect(cleanUpperText(undefined)).toBeNull();
    });
  });

  describe('normalizeCnaeCode', () => {
    it.each([
      [6201501, '6201501'],
      ['6201501', '6201501'],
      ['6201-5/01', '6201501'],
      [111301, '0111301'],
      ['0111301', '0111301'],
    ])('normaliza %j para %j', (value, expected) => {
      expect(normalizeCnaeCode(value)).toBe(expected);
    });

    it.each([
      [0],
      ['0'],
      ['0000000'],
      [''],
      [null],
      [undefined],
      ['abc'],
      [12345678],
    ])('trata %j como sem CNAE', (value) => {
      expect(normalizeCnaeCode(value)).toBeNull();
    });
  });

  describe('normalizeIbgeCode', () => {
    it('mantém o código de 7 dígitos, vindo como número ou texto', () => {
      expect(normalizeIbgeCode(3550308)).toBe('3550308');
      expect(normalizeIbgeCode('3550308')).toBe('3550308');
    });

    it('devolve os zeros iniciais perdidos pelo número', () => {
      expect(normalizeIbgeCode(110001)).toBe('0110001');
    });

    it('trata zero e ausência como sem informação', () => {
      expect(normalizeIbgeCode(0)).toBeNull();
      expect(normalizeIbgeCode(null)).toBeNull();
    });
  });

  describe('normalizeZipcode', () => {
    it.each([
      ['01310200', '01310200'],
      ['01310-200', '01310200'],
      [1310200, '01310200'],
      ['70040912', '70040912'],
    ])('normaliza %j para %j', (value, expected) => {
      expect(normalizeZipcode(value)).toBe(expected);
    });

    it.each([[''], [0], ['00000000'], ['123456789'], [null]])(
      'trata %j como sem CEP',
      (value) => {
        expect(normalizeZipcode(value)).toBeNull();
      },
    );
  });

  describe('normalizeUf', () => {
    it('aceita a sigla em qualquer caixa', () => {
      expect(normalizeUf('sp')).toBe('SP');
      expect(normalizeUf(' DF ')).toBe('DF');
    });

    it.each([['S'], ['SPX'], ['S1'], ['  '], [null], [11]])(
      'recusa %j',
      (value) => {
        expect(normalizeUf(value)).toBeNull();
      },
    );
  });

  describe('normalizeRegistrationStatus', () => {
    it('usa a descrição, em maiúsculas', () => {
      expect(normalizeRegistrationStatus(' Ativa ')).toBe('ATIVA');
    });

    it('a descrição prevalece sobre o código', () => {
      expect(normalizeRegistrationStatus('BAIXADA', 2)).toBe('BAIXADA');
    });

    it.each([
      [1, 'NULA'],
      [2, 'ATIVA'],
      ['3', 'SUSPENSA'],
      [4, 'INAPTA'],
      [8, 'BAIXADA'],
    ])(
      'traduz o código %j para %s quando não há descrição',
      (code, expected) => {
        expect(normalizeRegistrationStatus(null, code)).toBe(expected);
        expect(normalizeRegistrationStatus('', code)).toBe(expected);
      },
    );

    it.each([[99], ['x'], [null], [undefined]])(
      'devolve null para o código desconhecido %j',
      (code) => {
        expect(normalizeRegistrationStatus(null, code)).toBeNull();
      },
    );

    it('devolve null sem descrição nem código', () => {
      expect(normalizeRegistrationStatus(undefined)).toBeNull();
    });
  });

  describe('joinStreet', () => {
    it('junta o tipo ao nome do logradouro', () => {
      expect(joinStreet('avenida', 'PAULISTA')).toBe('AVENIDA PAULISTA');
    });

    it('não repete o tipo quando o nome já começa por ele', () => {
      expect(joinStreet('AVENIDA', 'Avenida Paulista')).toBe(
        'Avenida Paulista',
      );
    });

    it('sem tipo, devolve só o nome', () => {
      expect(joinStreet(null, 'PAULISTA')).toBe('PAULISTA');
      expect(joinStreet('  ', ' PAULISTA ')).toBe('PAULISTA');
    });

    it('sem nome, não há logradouro, mesmo com tipo', () => {
      expect(joinStreet('AVENIDA', null)).toBeNull();
      expect(joinStreet('AVENIDA', '  ')).toBeNull();
    });
  });
});
