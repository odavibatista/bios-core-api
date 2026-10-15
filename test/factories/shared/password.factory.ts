import { faker } from '../../support/faker.js';

/** Limite de bytes que o bcrypt considera; acima disso, o resto é ignorado. */
export const BCRYPT_INPUT_LIMIT = 72;

/**
 * Senha dentro do limite do bcrypt, como a maioria das senhas reais, e sempre
 * aceita pela política de senha do cadastro (letra e número): um sorteio
 * puramente aleatório pode não trazer dígito e tornaria os testes
 * intermitentes.
 */
export function buildPassword(): string {
  return faker.helpers
    .shuffle([
      ...faker.string.alpha({ length: 6 }),
      ...faker.string.numeric({ length: 4 }),
      ...faker.internet.password({ length: 6, memorable: false }),
    ])
    .join('');
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
