import { faker } from '@test/support/faker.js';
import {
  API_KEY_PUBLIC_ID_LENGTH,
  apiKeyPrefixOf,
  buildApiKey,
  parseApiKey,
} from './api-key-format.js';

function buildPublicId(): string {
  return faker.string.alphanumeric(API_KEY_PUBLIC_ID_LENGTH);
}

function buildSecret(): string {
  return faker.string.alphanumeric(43);
}

describe('buildApiKey', () => {
  it('monta bios_<identificador>_<segredo>', () => {
    expect(buildApiKey('AbCd1234', 'segredo')).toBe('bios_AbCd1234_segredo');
  });
});

describe('apiKeyPrefixOf', () => {
  it('é o início público da chave, sem o segredo', () => {
    const publicId = buildPublicId();
    const key = buildApiKey(publicId, buildSecret());

    expect(key.startsWith(apiKeyPrefixOf(publicId))).toBe(true);
    expect(apiKeyPrefixOf(publicId)).toBe(`bios_${publicId}`);
  });
});

describe('parseApiKey', () => {
  it('devolve o prefixo público de uma chave bem formada', () => {
    const publicId = buildPublicId();

    expect(parseApiKey(buildApiKey(publicId, buildSecret()))).toBe(
      `bios_${publicId}`,
    );
  });

  it('aceita o segredo em base64url, com hífen e sublinhado', () => {
    const key = buildApiKey('AbCd1234', `${'a-b_'.repeat(10)}abc`);

    expect(parseApiKey(key)).toBe('bios_AbCd1234');
  });

  it('ignora espaços nas bordas', () => {
    const key = buildApiKey(buildPublicId(), buildSecret());

    expect(parseApiKey(`  ${key}\n`)).not.toBeNull();
  });

  it('o prefixo não revela o segredo', () => {
    const secret = buildSecret();
    const prefix = parseApiKey(buildApiKey(buildPublicId(), secret));

    expect(prefix).not.toContain(secret);
  });

  it.each([
    ['vazio', ''],
    ['sem o início do BIOS', `AbCd1234_${'a'.repeat(43)}`],
    ['com outro início', `sk_AbCd1234_${'a'.repeat(43)}`],
    ['com identificador curto', `bios_AbCd123_${'a'.repeat(43)}`],
    ['com identificador longo', `bios_AbCd12345_${'a'.repeat(43)}`],
    ['com identificador fora do alfabeto', `bios_AbCd-234_${'a'.repeat(43)}`],
    ['com segredo curto', `bios_AbCd1234_${'a'.repeat(42)}`],
    ['com segredo longo', `bios_AbCd1234_${'a'.repeat(44)}`],
    ['com segredo fora do alfabeto', `bios_AbCd1234_${'a'.repeat(42)}!`],
    ['só o prefixo', 'bios_AbCd1234'],
    ['um JWT', 'eyJhbGciOiJIUzI1NiJ9.e30.abc'],
  ])('recusa texto %s', (_case, text) => {
    expect(parseApiKey(text)).toBeNull();
  });
});
