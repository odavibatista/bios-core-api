import { CreateApiKeyRequestSchema } from './api-key.dto.js';

describe('CreateApiKeyRequestSchema', () => {
  it('aceita um nome', () => {
    expect(
      CreateApiKeyRequestSchema.safeParse({ name: 'Integração com o CRM' })
        .success,
    ).toBe(true);
  });

  it('remove espaços nas bordas do nome', () => {
    const parsed = CreateApiKeyRequestSchema.parse({ name: '  Meu CRM  ' });

    expect(parsed.name).toBe('Meu CRM');
  });

  it.each([
    ['ausente', {}],
    ['vazio', { name: '' }],
    ['só espaços', { name: '    ' }],
    ['curto demais', { name: 'A' }],
    ['longo demais', { name: 'a'.repeat(61) }],
    ['que não é texto', { name: 123 }],
  ])('recusa nome %s', (_case, body) => {
    expect(CreateApiKeyRequestSchema.safeParse(body).success).toBe(false);
  });

  it('aceita o nome no tamanho máximo', () => {
    expect(
      CreateApiKeyRequestSchema.safeParse({ name: 'a'.repeat(60) }).success,
    ).toBe(true);
  });
});
