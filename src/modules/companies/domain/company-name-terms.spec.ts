import {
  extractNameTerms,
  hasSignificantTerm,
  MAX_NAME_TERMS,
} from './company-name-terms.js';

describe('extractNameTerms', () => {
  it('põe em maiúsculas e separa por espaço', () => {
    expect(extractNameTerms('banco do brasil')).toEqual([
      'BANCO',
      'DO',
      'BRASIL',
    ]);
  });

  it('ignora acentos, cedilha e til', () => {
    expect(extractNameTerms('Indústria Ação São João')).toEqual([
      'INDUSTRIA',
      'ACAO',
      'SAO',
      'JOAO',
    ]);
  });

  it('a pontuação separa as palavras e não vira termo', () => {
    expect(extractNameTerms('Ambev S.A. - Cia./Filial')).toEqual([
      'AMBEV',
      'S',
      'A',
      'CIA',
      'FILIAL',
    ]);
  });

  it('mantém dígitos', () => {
    expect(extractNameTerms('Loja 24 horas')).toEqual(['LOJA', '24', 'HORAS']);
  });

  it('texto sem letra nem dígito não tem termos', () => {
    expect(extractNameTerms(' *** -- ')).toEqual([]);
  });

  it('só devolve A-Z e 0-9, o que dispensa escapar a expressão regular', () => {
    const terms = extractNameTerms('a.b(c)[d]{e}|f\\g^h$i+j?k*l €ß日本');

    expect(terms.join('')).toMatch(/^[A-Z0-9]+$/);
  });

  it('descarta as palavras além do limite', () => {
    const text = Array.from({ length: MAX_NAME_TERMS + 4 }, (_, i) => `p${i}`);

    expect(extractNameTerms(text.join(' '))).toHaveLength(MAX_NAME_TERMS);
  });
});

describe('hasSignificantTerm', () => {
  it('aceita quando alguma palavra tem 3 caracteres ou mais', () => {
    expect(hasSignificantTerm(['A', 'B', 'ABC'])).toBe(true);
  });

  it('recusa quando todas são curtas', () => {
    expect(hasSignificantTerm(['A', 'DO', 'S'])).toBe(false);
  });

  it('recusa a lista vazia', () => {
    expect(hasSignificantTerm([])).toBe(false);
  });
});
