import { buildEmailToken } from '@test/factories/mailing/email-template.factory.js';
import { buildPassword } from '@test/factories/shared/password.factory.js';
import { faker } from '@test/support/faker.js';
import {
  ChangePasswordRequestSchema,
  ForgotPasswordRequestSchema,
  ResetPasswordRequestSchema,
} from './password.dto.js';

function invalidFields(
  schema: {
    safeParse(input: unknown): {
      success: boolean;
      error?: { issues: { path: PropertyKey[] }[] };
    };
  },
  input: unknown,
): string[] {
  const result = schema.safeParse(input);

  return result.success
    ? []
    : (result.error?.issues ?? []).map(({ path }) => path.join('.'));
}

describe('ChangePasswordRequestSchema', () => {
  const valid = () => ({
    current_password: buildPassword(),
    new_password: buildPassword(),
  });

  it('aceita a senha atual e uma nova que obedece à política', () => {
    expect(ChangePasswordRequestSchema.safeParse(valid()).success).toBe(true);
  });

  it('não aplica a política à senha atual (contas antigas, regra não revelada)', () => {
    const body = { ...valid(), current_password: 'a' };

    expect(ChangePasswordRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['curta', 'abc123'],
    ['sem número', 'somenteletras'],
    ['sem letra', '1234567890'],
    ['longa demais', `a1${'x'.repeat(127)}`],
  ])('recusa nova senha %s', (_case, newPassword) => {
    expect(
      invalidFields(ChangePasswordRequestSchema, {
        ...valid(),
        new_password: newPassword,
      }),
    ).toEqual(['new_password']);
  });

  it.each(['current_password', 'new_password'])('exige %s', (field) => {
    const body: Record<string, unknown> = valid();
    delete body[field];

    expect(invalidFields(ChangePasswordRequestSchema, body)).toEqual([field]);
  });

  it('recusa senha atual vazia', () => {
    expect(
      invalidFields(ChangePasswordRequestSchema, {
        ...valid(),
        current_password: '',
      }),
    ).toEqual(['current_password']);
  });
});

describe('ForgotPasswordRequestSchema', () => {
  it('aceita um e-mail', () => {
    expect(
      ForgotPasswordRequestSchema.safeParse({ email: faker.internet.email() })
        .success,
    ).toBe(true);
  });

  it.each(['', 'sem-arroba', 'a@'])('recusa o e-mail "%s"', (email) => {
    expect(ForgotPasswordRequestSchema.safeParse({ email }).success).toBe(
      false,
    );
  });

  it('exige o e-mail', () => {
    expect(ForgotPasswordRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('ResetPasswordRequestSchema', () => {
  const valid = () => ({
    token: buildEmailToken(),
    new_password: buildPassword(),
  });

  it('aceita o token e uma senha que obedece à política', () => {
    expect(ResetPasswordRequestSchema.safeParse(valid()).success).toBe(true);
  });

  it.each([
    ['curta', 'abc123'],
    ['sem número', 'somenteletras'],
    ['sem letra', '1234567890'],
  ])('recusa nova senha %s', (_case, newPassword) => {
    expect(
      invalidFields(ResetPasswordRequestSchema, {
        ...valid(),
        new_password: newPassword,
      }),
    ).toEqual(['new_password']);
  });

  it.each([
    ['vazio', ''],
    ['longo demais', 'a'.repeat(201)],
  ])('recusa token %s', (_case, token) => {
    expect(
      invalidFields(ResetPasswordRequestSchema, { ...valid(), token }),
    ).toEqual(['token']);
  });

  it.each(['token', 'new_password'])('exige %s', (field) => {
    const body: Record<string, unknown> = valid();
    delete body[field];

    expect(invalidFields(ResetPasswordRequestSchema, body)).toEqual([field]);
  });
});
