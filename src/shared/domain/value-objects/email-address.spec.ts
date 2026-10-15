import { faker } from '@test/support/faker.js';
import { firstNameOf, normalizeEmail } from './email-address.js';

describe('normalizeEmail', () => {
  it('põe em minúsculas', () => {
    const email = faker.internet.email().toLowerCase();

    expect(normalizeEmail(email.toUpperCase())).toBe(email);
  });

  it('remove espaços nas bordas', () => {
    const email = faker.internet.email().toLowerCase();

    expect(normalizeEmail(`  ${email}\t`)).toBe(email);
  });

  it('mantém o que já está na forma canônica', () => {
    const email = faker.internet.email().toLowerCase();

    expect(normalizeEmail(email)).toBe(email);
  });
});

describe('firstNameOf', () => {
  it('devolve o primeiro nome de um nome completo', () => {
    const first = faker.string.alpha({ length: 6 });
    const last = faker.string.alpha({ length: 8 });

    expect(firstNameOf(`${first} ${last}`)).toBe(first);
  });

  it('ignora espaços nas bordas e repetidos', () => {
    const first = faker.string.alpha({ length: 6 });

    expect(
      firstNameOf(`  ${first}   ${faker.string.alpha({ length: 8 })} `),
    ).toBe(first);
  });

  it('devolve o nome inteiro quando há uma só palavra', () => {
    const name = faker.string.alpha({ length: 6 });

    expect(firstNameOf(name)).toBe(name);
  });
});
