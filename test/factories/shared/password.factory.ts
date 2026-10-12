import { faker } from '../../support/faker.js';

/** Limite de bytes que o bcrypt considera; acima disso, o resto é ignorado. */
export const BCRYPT_INPUT_LIMIT = 72;

/** Senha dentro do limite do bcrypt, como a maioria das senhas reais. */
export function buildPassword(): string {
  return faker.internet.password({ length: 16, memorable: false });
}

/**
 * Par de senhas longas idênticas até o limite do bcrypt e diferentes depois
 * dele: sem o pré-hash, uma seria aceita no lugar da outra.
 */
export function buildCollidingLongPasswords(): [string, string] {
  const shared = faker.string.alphanumeric({ length: BCRYPT_INPUT_LIMIT });
  const [first, second] = faker.helpers.uniqueArray(
    () => faker.string.alphanumeric({ length: 12 }),
    2,
  );

  return [`${shared}${first}`, `${shared}${second}`];
}
