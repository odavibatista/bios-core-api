import {
  formatBrl,
  formatDate,
  formatHectares,
  parseBrazilianNumber,
  parseIbamaDate,
} from './ibama-values.js';

describe('parseBrazilianNumber', () => {
  it.each([
    ['6932,00', 6932],
    ['12,5000', 12.5],
    ['0,5', 0.5],
    ['1.234,56', 1234.56],
    ['1.234.567,89', 1_234_567.89],
    ['  127,36  ', 127.36],
    ['42', 42],
    ['1000.5', 1000.5],
  ])('"%s" vale %d', (text, expected) => {
    expect(parseBrazilianNumber(text)).toBe(expected);
  });

  it.each([undefined, '', '   ', 'abc', '12,3,4', 'R$ 10,00'])(
    'sem valor aproveitável (%s): null',
    (text) => {
      expect(parseBrazilianNumber(text)).toBeNull();
    },
  );
});

describe('parseIbamaDate', () => {
  it.each([
    ['2024-05-17 10:30:00', '2024-05-17'],
    ['2024-05-17', '2024-05-17'],
    ['1980-02-08 00:00:00', '1980-02-08'],
    ['2024-02-29', '2024-02-29'],
    ['  2026-10-19 16:18:45  ', '2026-10-19'],
    ['2024-05-17T10:30', '2024-05-17'],
  ])('"%s" é o dia %s, à meia-noite UTC', (text, day) => {
    expect(parseIbamaDate(text)?.toISOString()).toBe(`${day}T00:00:00.000Z`);
  });

  it.each([
    undefined,
    '',
    'ontem',
    '17/05/2024',
    '2024-13-01',
    '2024-02-30',
    '2023-02-29',
    '2024-00-10',
  ])('data ausente ou inválida (%s): null', (text) => {
    expect(parseIbamaDate(text)).toBeNull();
  });

  it('o horário do dump não muda o dia (o fuso é desconhecido)', () => {
    expect(parseIbamaDate('2024-05-17 23:59:59')).toEqual(
      parseIbamaDate('2024-05-17 00:00:01'),
    );
  });
});

describe('formatação em português', () => {
  it('reais, com espaço comum', () => {
    expect(formatBrl(6932)).toBe('R$ 6.932,00');
    expect(formatBrl(127.36)).toBe('R$ 127,36');
    expect(formatBrl(1_234_567.8)).toBe('R$ 1.234.567,80');
    expect(formatBrl(6932)).not.toContain(' ');
  });

  it('hectares, com até 4 casas', () => {
    expect(formatHectares(12.5)).toBe('12,5');
    expect(formatHectares(481.3829)).toBe('481,3829');
    expect(formatHectares(3)).toBe('3');
    expect(formatHectares(0.12345)).toBe('0,1235');
  });

  it('data como dia/mês/ano, pelo dia UTC', () => {
    expect(formatDate(new Date('2024-05-07T00:00:00.000Z'))).toBe('07/05/2024');
    expect(formatDate(new Date('2024-12-31T23:59:59.000Z'))).toBe('31/12/2024');
  });
});
