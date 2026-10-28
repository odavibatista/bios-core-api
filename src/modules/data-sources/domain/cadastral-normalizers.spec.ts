import {
  cleanText,
  cleanUpperText,
  joinStreet,
  normalizeCnaeCode,
  normalizeCompanySize,
  normalizeIbgeCode,
  normalizeRegistrationStatus,
  normalizeUf,
  normalizeZipcode,
  REGISTRATION_STATUSES,
  storedRegistrationStatus,
} from './cadastral-normalizers.js';

describe('normalizadores cadastrais', () => {
  describe('normalizeCompanySize', () => {
    it.each([
      ['Demais', 'DEMAIS'],
      ['DEMAIS', 'DEMAIS'],
      ['  demais ', 'DEMAIS'],
      ['MICRO EMPRESA', 'MICRO EMPRESA'],
      ['Microempresa', 'MICRO EMPRESA'],
      ['MICROEMPRESA', 'MICRO EMPRESA'],
      ['Micro-Empresa', 'MICRO EMPRESA'],
      ['ME', 'MICRO EMPRESA'],
      ['EMPRESA DE PEQUENO PORTE', 'EMPRESA DE PEQUENO PORTE'],
      ['Empresa de Pequeno Porte', 'EMPRESA DE PEQUENO PORTE'],
      ['EPP', 'EMPRESA DE PEQUENO PORTE'],
      ['Pequeno Porte', 'EMPRESA DE PEQUENO PORTE'],
    ])('escreve %j como %j', (value, expected) => {
      expect(normalizeCompanySize(value)).toBe(expected);
    });

    it.each([['NÃO INFORMADO'], ['Nao Informado'], ['NAO-INFORMADO']])(
      'trata %j como porte não informado',
      (value) => {
        expect(normalizeCompanySize(value)).toBeNull();
      },
    );

    it.each([[''], ['   '], [null], [undefined]])(
      'trata %j como ausente',
      (value) => {
        expect(normalizeCompanySize(value)).toBeNull();
      },
    );

    it('mantém, em maiúsculas e sem acento, um porte que não conhece', () => {
      expect(normalizeCompanySize('Grande Porte')).toBe('GRANDE PORTE');
      expect(normalizeCompanySize('Média Empresa')).toBe('MEDIA EMPRESA');
    });
  });

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

  describe('normalizeRegistrationStatus (conjunto fechado, #338)', () => {
    const recognized = (status: string) => ({ status, unrecognized: null });

    it.each([
      // BrasilAPI e Minha Receita: descrição em maiúsculas, com o código ao lado.
      ['ATIVA', 2, 'ATIVA'],
      ['BAIXADA', 8, 'BAIXADA'],
      ['INAPTA', 4, 'INAPTA'],
      ['SUSPENSA', 3, 'SUSPENSA'],
      ['NULA', 1, 'NULA'],
      // OpenCNPJ: só a descrição, com a primeira letra maiúscula.
      ['Ativa', undefined, 'ATIVA'],
      ['Baixada', undefined, 'BAIXADA'],
      ['Inapta', undefined, 'INAPTA'],
      ['Suspensa', undefined, 'SUSPENSA'],
      ['Nula', undefined, 'NULA'],
    ] as const)(
      'grafia conhecida dos provedores: %j (código %j) é %s',
      (description, code, expected) => {
        expect(normalizeRegistrationStatus(description, code)).toEqual(
          recognized(expected),
        );
      },
    );

    it.each([' ativa ', 'ATIVA.', 'Áti-va'])(
      'compara só as letras, sem caixa, acento ou pontuação: %j',
      (description) => {
        expect(normalizeRegistrationStatus(description)).toEqual(
          recognized('ATIVA'),
        );
      },
    );

    it('a descrição prevalece sobre o código', () => {
      expect(normalizeRegistrationStatus('BAIXADA', 2)).toEqual(
        recognized('BAIXADA'),
      );
    });

    it.each([
      [1, 'NULA'],
      [2, 'ATIVA'],
      ['3', 'SUSPENSA'],
      [4, 'INAPTA'],
      ['08', 'BAIXADA'],
    ])(
      'traduz o código %j para %s quando não há descrição',
      (code, expected) => {
        expect(normalizeRegistrationStatus(null, code)).toEqual(
          recognized(expected),
        );
        expect(normalizeRegistrationStatus('', code)).toEqual(
          recognized(expected),
        );
      },
    );

    it('código no lugar da descrição também é traduzido', () => {
      expect(normalizeRegistrationStatus('02')).toEqual(recognized('ATIVA'));
    });

    it('descrição desconhecida com código conhecido: vale o código', () => {
      expect(normalizeRegistrationStatus('Situação especial', 2)).toEqual(
        recognized('ATIVA'),
      );
    });

    it('situação desconhecida não derruba o cadastro nem se perde: NAO_RECONHECIDA, com o texto do provedor', () => {
      expect(normalizeRegistrationStatus('  Em liquidação ')).toEqual({
        status: 'NAO_RECONHECIDA',
        unrecognized: 'Em liquidação',
      });
    });

    it.each([[99], ['x']])(
      'código desconhecido sem descrição também é preservado: %j',
      (code) => {
        expect(normalizeRegistrationStatus(null, code)).toEqual({
          status: 'NAO_RECONHECIDA',
          unrecognized: String(code),
        });
      },
    );

    it.each([[null], [undefined], ['   ']])(
      'devolve null quando o provedor não informa situação alguma (%j)',
      (code) => {
        expect(normalizeRegistrationStatus(undefined, code)).toBeNull();
        expect(normalizeRegistrationStatus('', code)).toBeNull();
      },
    );

    it('o conjunto declarado tem as cinco situações da Receita e a não reconhecida', () => {
      expect([...REGISTRATION_STATUSES].sort()).toEqual(
        [
          'ATIVA',
          'BAIXADA',
          'INAPTA',
          'NAO_RECONHECIDA',
          'NULA',
          'SUSPENSA',
        ].sort(),
      );
    });
  });

  describe('storedRegistrationStatus', () => {
    it.each(REGISTRATION_STATUSES)('situação do conjunto: %s', (status) => {
      expect(storedRegistrationStatus(status, null)).toEqual({
        status,
        unrecognized: null,
      });
    });

    it('NAO_RECONHECIDA gravada mantém o texto do provedor', () => {
      expect(
        storedRegistrationStatus('NAO_RECONHECIDA', 'Em liquidação'),
      ).toEqual({ status: 'NAO_RECONHECIDA', unrecognized: 'Em liquidação' });
    });

    it('descrição gravada antes do conjunto fechado vira NAO_RECONHECIDA, sem perder o texto', () => {
      expect(storedRegistrationStatus('EM LIQUIDACAO', null)).toEqual({
        status: 'NAO_RECONHECIDA',
        unrecognized: 'EM LIQUIDACAO',
      });
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
