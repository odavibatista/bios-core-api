import { faker } from './faker.js';

/** Dígito verificador do CNPJ numérico (módulo 11) sobre os dígitos já conhecidos. */
function checkDigit(digits: number[]): number {
  const weights =
    digits.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = digits.reduce(
    (total, digit, index) => total + digit * weights[index],
    0,
  );
  const rest = sum % 11;

  return rest < 2 ? 0 : 11 - rest;
}

/**
 * CNPJs numéricos válidos e **distintos entre si**.
 *
 * `buildCnpj()` sorteia de uma lista de poucos CNPJs fixos: serve a um teste de
 * uma empresa, mas repete valores quando o cenário precisa de várias (elas passam a
 * dividir cache e evidências, e o resultado deixa de ser determinístico).
 */
export function buildDistinctCnpjs(count: number): string[] {
  const start = faker.number.int({ min: 10_000_000, max: 89_000_000 });

  return Array.from({ length: count }, (_, index) => {
    const base = `${start + index}0001`.split('').map(Number);
    const first = checkDigit(base);
    const second = checkDigit([...base, first]);

    return [...base, first, second].join('');
  });
}
