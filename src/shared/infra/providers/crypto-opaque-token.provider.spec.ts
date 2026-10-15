import { faker } from '@test/support/faker.js';
import { CryptoOpaqueTokenProvider } from './crypto-opaque-token.provider.js';

describe('CryptoOpaqueTokenProvider', () => {
  const provider = new CryptoOpaqueTokenProvider();

  it('gera tokens diferentes a cada chamada', () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => provider.generate().token),
    );

    expect(tokens.size).toBe(50);
  });

  it('gera um token seguro em URL, com 256 bits', () => {
    const { token } = provider.generate();

    // 32 bytes em base64url: 43 caracteres, sem preenchimento nem símbolos de URL.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('devolve o resumo que a busca reproduz a partir do token', () => {
    const { token, hash } = provider.generate();

    expect(provider.hash(token)).toBe(hash);
  });

  it('gera resumo SHA-256 em hexadecimal que não revela o token', () => {
    const { token, hash } = provider.generate();

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it('resume o mesmo texto sempre do mesmo jeito', () => {
    const token = faker.string.alphanumeric(43);

    expect(provider.hash(token)).toBe(provider.hash(token));
  });

  it('resume textos diferentes em valores diferentes', () => {
    const [first, second] = faker.helpers.uniqueArray(
      () => faker.string.alphanumeric(43),
      2,
    );

    expect(provider.hash(first)).not.toBe(provider.hash(second));
  });

  it('é sensível a diferença de caixa', () => {
    // O token é base64url: maiúsculas e minúsculas são valores distintos.
    expect(provider.hash('AbC')).not.toBe(provider.hash('abc'));
  });
});
