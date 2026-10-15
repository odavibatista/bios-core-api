import { faker } from '@test/support/faker.js';
import { decodePendingEmail, encodePendingEmail } from './pending-email.js';

describe('pending e-mail', () => {
  it('guarda a versão da chave junto do texto cifrado e a devolve', () => {
    const value = {
      ciphertext: faker.string.alphanumeric({ length: 60 }),
      keyVersion: faker.number.int({ min: 1, max: 9_999 }),
    };

    expect(decodePendingEmail(encodePendingEmail(value))).toEqual(value);
  });

  it('aceita o alfabeto do base64url (com hífen e sublinhado)', () => {
    const value = { ciphertext: 'abc-DEF_123', keyVersion: 2 };

    expect(decodePendingEmail(encodePendingEmail(value))).toEqual(value);
  });

  it('a forma guardada é <versão>:<texto cifrado>', () => {
    expect(encodePendingEmail({ ciphertext: 'abc', keyVersion: 3 })).toBe(
      '3:abc',
    );
  });

  it.each([
    ['sem versão', 'abc'],
    ['sem texto cifrado', '3:'],
    ['com versão que não é número', 'v3:abc'],
    ['com separador a mais', '3:abc:def'],
    ['com caractere fora do base64url', '3:abc+/='],
    ['vazio', ''],
    ['em claro, com @', 'pessoa@exemplo.com'],
  ])('recusa o texto %s', (_case, encoded) => {
    expect(decodePendingEmail(encoded)).toBeNull();
  });
});
