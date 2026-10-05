import { faker } from '@test/support/faker.js';
import { Duration } from './duration.js';

describe('Duration', () => {
  it.each([
    ['s', 1],
    ['m', 60],
    ['h', 3_600],
    ['d', 86_400],
    ['w', 604_800],
  ])('interpreta quantidades em "%s" (%i segundos cada)', (unit, seconds) => {
    const amount = faker.number.int({ max: 10_000 });

    expect(Duration.parse(`${amount}${unit}`).toSeconds()).toBe(
      amount * seconds,
    );
  });

  it('ignora espaços nas bordas e diferença de caixa', () => {
    const days = faker.number.int({ min: 1, max: 999 });

    expect(Duration.parse(` ${days}D `).toSeconds()).toBe(days * 86_400);
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
    const seconds = faker.number.int({ max: 10_000_000 });

    expect(Duration.ofSeconds(seconds).toMilliseconds()).toBe(seconds * 1_000);
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
    const days = faker.number.int({ min: 1, max: 365 });
    const duration = Duration.parse(`${days}d`);

    expect(duration.isAtLeast(Duration.parse(`${days * 24}h`))).toBe(true);
    expect(duration.isAtLeast(Duration.parse(`${days + 1}d`))).toBe(false);
    expect(duration.equals(Duration.parse(`${days * 1_440}m`))).toBe(true);
  });

  it.each([-1, 1.5, Number.NaN])('rejeita %d segundos', (seconds) => {
    expect(() => Duration.ofSeconds(seconds)).toThrow(RangeError);
  });
});
