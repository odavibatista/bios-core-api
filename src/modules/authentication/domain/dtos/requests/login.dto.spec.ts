import { buildPassword } from '@test/factories/shared/password.factory.js';
import { faker } from '@test/support/faker.js';
import { LoginRequestSchema } from './login.dto.js';

describe('LoginRequestSchema', () => {
  it('aceita e-mail e senha', () => {
    const body = { email: faker.internet.email(), password: buildPassword() };

    expect(LoginRequestSchema.safeParse(body).success).toBe(true);
  });

  it('não aplica a política de senha do cadastro', () => {
    // Contas antigas e a regra em si não podem ser reveladas pelo login.
    const body = { email: faker.internet.email(), password: 'a' };

    expect(LoginRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each(['', 'sem-arroba', 'a@'])('recusa o e-mail "%s"', (email) => {
    const result = LoginRequestSchema.safeParse({
      email,
      password: buildPassword(),
    });

    expect(result.success).toBe(false);
  });

  it('recusa senha vazia', () => {
    const result = LoginRequestSchema.safeParse({
      email: faker.internet.email(),
      password: '',
    });

    expect(result.success).toBe(false);
  });

  it('recusa senha acima de 128 caracteres, para não gastar hash à toa', () => {
    const result = LoginRequestSchema.safeParse({
      email: faker.internet.email(),
      password: 'a'.repeat(129),
    });

    expect(result.success).toBe(false);
  });

  it.each(['email', 'password'])('exige o campo %s', (field) => {
    const body: Record<string, unknown> = {
      email: faker.internet.email(),
      password: buildPassword(),
    };
    delete body[field];

    expect(LoginRequestSchema.safeParse(body).success).toBe(false);
  });
});
