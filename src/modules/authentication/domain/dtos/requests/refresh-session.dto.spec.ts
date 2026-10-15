import { faker } from '@test/support/faker.js';
import { RefreshSessionRequestSchema } from './refresh-session.dto.js';

describe('RefreshSessionRequestSchema', () => {
  it('aceita um refresh token', () => {
    const body = { refresh_token: faker.string.alphanumeric(43) };

    expect(RefreshSessionRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['vazio', { refresh_token: '' }],
    ['ausente', {}],
    ['longo demais', { refresh_token: 'a'.repeat(201) }],
    ['que não é texto', { refresh_token: 123 }],
  ])('recusa refresh token %s', (_case, body) => {
    expect(RefreshSessionRequestSchema.safeParse(body).success).toBe(false);
  });
});
