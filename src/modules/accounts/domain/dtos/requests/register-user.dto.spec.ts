import { buildPassword } from '@test/factories/shared/password.factory.js';
import { faker } from '@test/support/faker.js';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordSchema,
  RegisterUserRequestSchema,
} from './register-user.dto.js';

function buildRequest(overrides: Record<string, unknown> = {}) {
  return {
    name: faker.person.fullName(),
    email: faker.internet.email(),
    password: buildPassword(),
    ...overrides,
  };
}

/** Caminho dos campos que o schema recusou. */
function invalidFields(input: unknown): string[] {
  const result = RegisterUserRequestSchema.safeParse(input);

  return result.success
    ? []
    : result.error.issues.map(({ path }) => path.join('.'));
}

describe('RegisterUserRequestSchema', () => {
  it('aceita um cadastro válido', () => {
    expect(RegisterUserRequestSchema.safeParse(buildRequest()).success).toBe(
      true,
    );
  });

  it('remove espaços nas bordas do nome', () => {
    const name = faker.person.fullName();

    const result = RegisterUserRequestSchema.parse(
      buildRequest({ name: `  ${name}  ` }),
    );

    expect(result.name).toBe(name);
  });

  it.each([
    ['vazio', ''],
    ['uma letra', 'A'],
    ['só espaços', '   '],
    ['longo demais', 'a'.repeat(101)],
  ])('recusa nome %s', (_case, name) => {
    expect(invalidFields(buildRequest({ name }))).toEqual(['name']);
  });

  it.each(['sem-arroba', 'a@', '@dominio.com', 'a b@dominio.com', ''])(
    'recusa o e-mail "%s"',
    (email) => {
      expect(invalidFields(buildRequest({ email }))).toEqual(['email']);
    },
  );

  it('recusa e-mail acima de 254 caracteres', () => {
    const email = `${'a'.repeat(250)}@x.com`;

    expect(invalidFields(buildRequest({ email }))).toEqual(['email']);
  });

  it.each(['name', 'email', 'password'])('exige o campo %s', (field) => {
    const request: Record<string, unknown> = buildRequest();
    delete request[field];

    expect(invalidFields(request)).toEqual([field]);
  });
});

describe('PasswordSchema', () => {
  it.each([
    ['no tamanho mínimo', `abc12345`.slice(0, PASSWORD_MIN_LENGTH)],
    ['frase longa com número', `${'frase longa '.repeat(8)}2026`],
    ['com letras acentuadas', 'Ação1234'],
    ['com símbolos', 'senha-forte#1'],
  ])('aceita senha %s', (_case, password) => {
    expect(PasswordSchema.safeParse(password).success).toBe(true);
  });

  it('aceita senha no tamanho máximo', () => {
    const password = `a1${'x'.repeat(PASSWORD_MAX_LENGTH - 2)}`;

    expect(PasswordSchema.safeParse(password).success).toBe(true);
  });

  it('recusa senha curta demais', () => {
    expect(PasswordSchema.safeParse('abc1234').success).toBe(false);
  });

  it('recusa senha acima do tamanho máximo', () => {
    const password = `a1${'x'.repeat(PASSWORD_MAX_LENGTH - 1)}`;

    expect(PasswordSchema.safeParse(password).success).toBe(false);
  });

  it('recusa senha sem número', () => {
    const result = PasswordSchema.safeParse('somenteletras');

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/número/);
  });

  it('recusa senha sem letra', () => {
    const result = PasswordSchema.safeParse('1234567890');

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/letra/);
  });
});
