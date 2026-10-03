import { Duration } from './duration.js';

describe('Duration', () => {
  it.each([
    ['45s', 45],
    ['30m', 1_800],
    ['12h', 43_200],
    ['7d', 604_800],
    ['4w', 2_419_200],
    [' 90D ', 7_776_000],
  ])('interpreta "%s" como %i segundos', (text, seconds) => {
    expect(Duration.parse(text).toSeconds()).toBe(seconds);
  });

  it.each([
    '90',
    '7 d',
    '1.5h',
    '-1d',
    '7y',
    '',
    `${Number.MAX_SAFE_INTEGER}w`,
  ])('rejeita o formato inválido "%s"', (text) => {
    expect(Duration.tryParse(text)).toBeUndefined();
    expect(() => Duration.parse(text)).toThrow(RangeError);
  });

  it('converte para milissegundos', () => {
    expect(Duration.parse('2m').toMilliseconds()).toBe(120_000);
  });

  it.each([
    [604_800, '1w'],
    [7_776_000, '90d'],
    [5_400, '90m'],
    [61, '61s'],
    [0, '0w'],
  ])('representa %i segundos como "%s"', (seconds, text) => {
    expect(Duration.ofSeconds(seconds).toString()).toBe(text);
  });

  it('compara durações', () => {
    const oneDay = Duration.parse('1d');

    expect(oneDay.isAtLeast(Duration.parse('24h'))).toBe(true);
    expect(oneDay.isAtLeast(Duration.parse('2d'))).toBe(false);
    expect(oneDay.equals(Duration.parse('1440m'))).toBe(true);
  });

  it.each([-1, 1.5, Number.NaN])('rejeita %d segundos', (seconds) => {
    expect(() => Duration.ofSeconds(seconds)).toThrow(RangeError);
  });
});
