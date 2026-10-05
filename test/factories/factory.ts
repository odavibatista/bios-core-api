import { faker } from '../support/faker.js';

/**
 * Fábrica de dados de teste.
 *
 * Cada chamada gera um objeto novo, com todos os campos preenchidos pelo
 * Faker. `overrides` fixa apenas o que importa para o cenário do teste; o
 * restante continua aleatório.
 */
export interface Factory<T> {
  build(overrides?: Partial<T>): T;
  buildMany(count: number, overrides?: Partial<T>): T[];
}

/**
 * Cria uma fábrica a partir de um molde que devolve um objeto completo e
 * válido a cada chamada.
 */
export function defineFactory<T extends object>(
  blueprint: () => T,
): Factory<T> {
  const build = (overrides: Partial<T> = {}): T => ({
    ...blueprint(),
    ...overrides,
  });

  return {
    build,
    buildMany: (count, overrides) =>
      Array.from({ length: count }, () => build(overrides)),
  };
}

/** Datas de criação e de última atualização de um registro, coerentes entre si. */
export function timestamps(): { created_at: Date; updated_at: Date } {
  const created_at = faker.date.past();

  return {
    created_at,
    updated_at: faker.date.between({ from: created_at, to: new Date() }),
  };
}
