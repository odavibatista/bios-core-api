import { faker } from '@test/support/faker.js';
import { AddBlockedEmailDomainRequestSchema } from './blocked-email-domain.dto.js';

describe('AddBlockedEmailDomainRequestSchema (UC13, fluxo 4)', () => {
  const parse = (domain: unknown) =>
    AddBlockedEmailDomainRequestSchema.safeParse({ domain });

  it.each([
    'mailinator.com',
    'guerrillamail.com.br',
    'sub-dominio.exemplo.org',
    '10minutemail.net',
    'xn--exmplo-bva.com',
    'exemplo.xn--p1ai',
  ])('aceita %s', (domain) => {
    expect(parse(domain)).toMatchObject({ success: true, data: { domain } });
  });

  it('aceita qualquer domínio gerado pelo Faker', () => {
    const domain = faker.internet.domainName();

    expect(parse(domain).success).toBe(true);
  });

  it('normaliza: sem espaços nas bordas e em minúsculas', () => {
    expect(parse('  MailInator.COM ')).toMatchObject({
      success: true,
      data: { domain: 'mailinator.com' },
    });
  });

  it.each([
    ['com @', '@mailinator.com'],
    ['e-mail inteiro', 'fulano@mailinator.com'],
    ['sem ponto', 'localhost'],
    ['ponto duplo', 'mailinator..com'],
    ['hífen no começo do rótulo', '-mailinator.com'],
    ['hífen no fim do rótulo', 'mailinator-.com'],
    ['espaço no meio', 'mail inator.com'],
    ['com esquema', 'https://mailinator.com'],
    ['com caminho', 'mailinator.com/x'],
    ['domínio de topo numérico', 'mailinator.c0m'],
    ['domínio de topo de uma letra', 'mailinator.c'],
    ['vazio', ''],
    ['rótulo com mais de 63 caracteres', `${'a'.repeat(64)}.com`],
    ['mais de 253 caracteres', `${'a.'.repeat(126)}com`],
  ])('recusa %s', (_case, domain) => {
    expect(parse(domain).success).toBe(false);
  });

  it('recusa o que não é texto', () => {
    expect(parse(42).success).toBe(false);
    expect(AddBlockedEmailDomainRequestSchema.safeParse({}).success).toBe(
      false,
    );
  });
});
