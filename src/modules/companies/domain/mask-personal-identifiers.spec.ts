import {
  CPF_MASK,
  maskPersonalIdentifiers,
  maskPersonalIdentifiersOrNull,
} from './mask-personal-identifiers.js';

describe('maskPersonalIdentifiers', () => {
  it('mascara o CPF que a Receita grava no fim da razão social de MEI', () => {
    expect(maskPersonalIdentifiers('JOSE DA SILVA 12345678901')).toBe(
      'JOSE DA SILVA ***',
    );
  });

  it.each([
    ['sem pontuação', 'MARIA SOUZA 12345678901', 'MARIA SOUZA ***'],
    ['com pontuação', 'MARIA SOUZA 123.456.789-01', 'MARIA SOUZA ***'],
    ['só com o hífen', 'MARIA SOUZA 123456789-01', 'MARIA SOUZA ***'],
    ['só com os pontos', 'MARIA SOUZA 123.456.78901', 'MARIA SOUZA ***'],
    ['no começo', '12345678901 MARIA SOUZA', '*** MARIA SOUZA'],
    ['no meio', 'MARIA 12345678901 SOUZA', 'MARIA *** SOUZA'],
    ['sozinho', '12345678901', '***'],
  ])('CPF %s', (_case, text, expected) => {
    expect(maskPersonalIdentifiers(text)).toBe(expected);
  });

  it('mascara mais de um CPF no mesmo texto', () => {
    expect(maskPersonalIdentifiers('A 11122233344 B 555.666.777-88')).toBe(
      'A *** B ***',
    );
  });

  it('não confere os dígitos verificadores: errar para o lado de mascarar', () => {
    expect(maskPersonalIdentifiers('X 11111111111')).toBe('X ***');
  });

  it.each([
    ['CNPJ numérico (14 dígitos)', 'ACME 11222333000181'],
    ['CNPJ formatado', 'ACME 11.222.333/0001-81'],
    ['número de 10 dígitos', 'ACME 1234567890'],
    ['número de 12 dígitos', 'ACME 123456789012'],
    ['texto sem número', 'ACME SERVICOS LTDA'],
    ['número curto', 'ACME 24 HORAS 123'],
    ['letras no meio dos dígitos', 'ACME 12345A678901'],
  ])('não toca em %s', (_case, text) => {
    expect(maskPersonalIdentifiers(text)).toBe(text);
  });

  it('é idempotente', () => {
    const once = maskPersonalIdentifiers('JOSE 12345678901');

    expect(maskPersonalIdentifiers(once)).toBe(once);
  });

  it('a máscara é a mesma em toda chamada', () => {
    expect(CPF_MASK).toBe('***');
  });

  describe('maskPersonalIdentifiersOrNull', () => {
    it('preserva a ausência', () => {
      expect(maskPersonalIdentifiersOrNull(null)).toBeNull();
    });

    it('mascara quando há texto', () => {
      expect(maskPersonalIdentifiersOrNull('JOSE 12345678901')).toBe(
        'JOSE ***',
      );
    });
  });
});
