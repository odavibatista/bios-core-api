import { randomBytes } from 'node:crypto';
import {
  buildHexKey,
  buildKey,
  buildKeyring,
} from '@test/factories/shared/encryption-key.factory.js';
import { faker } from '@test/support/faker.js';
import { z } from 'zod';
import {
  decodeKey,
  encryptionKeyring,
  KEY_LENGTH_BYTES,
  singleKey,
} from './encryption.config.js';

describe('decodeKey', () => {
  it.each([
    ['base64', buildKey],
    ['hexadecimal', buildHexKey],
  ])('aceita uma chave de 32 bytes em %s', (_encoding, build) => {
    expect(decodeKey(build())).toHaveLength(KEY_LENGTH_BYTES);
  });

  it('ignora espaços nas bordas', () => {
    const material = buildKey();

    expect(decodeKey(`  ${material}  `)).toEqual(decodeKey(material));
  });

  it.each([
    ['vazia', ''],
    ['curta', randomBytes(16).toString('base64')],
    ['longa', randomBytes(64).toString('base64')],
    ['sem ser base64 nem hexadecimal', '!!!'],
  ])('rejeita uma chave %s', (_case, material) => {
    expect(decodeKey(material)).toBeUndefined();
  });
});

describe('encryptionKeyring', () => {
  const schema = z.object({ keys: encryptionKeyring() });

  it('aceita uma única versão', () => {
    const { keys } = schema.parse({ keys: buildKeyring([1]) }).keys;

    expect([...keys.keys()]).toEqual([1]);
  });

  it('mantém todas as versões informadas, para a rotação gradual', () => {
    const versions = faker.helpers.uniqueArray(
      () => faker.number.int({ min: 1, max: 999 }),
      faker.number.int({ min: 2, max: 5 }),
    );

    const keyring = schema.parse({ keys: buildKeyring(versions) }).keys;

    expect([...keyring.keys.keys()].sort()).toEqual([...versions].sort());
    expect(keyring.activeVersion).toBe(Math.max(...versions));
    expect(
      [...keyring.keys.values()].every(
        (key) => key.length === KEY_LENGTH_BYTES,
      ),
    ).toBe(true);
  });

  it('aceita versões em qualquer ordem, elegendo a maior como ativa', () => {
    const keyring = schema.parse({ keys: buildKeyring([3, 1, 2]) }).keys;

    expect(keyring.activeVersion).toBe(3);
  });

  it.each([
    ['vazia', ''],
    ['sem versão', buildKey()],
    ['com versão zero', `0:${buildKey()}`],
    ['com versão não numérica', `v1:${buildKey()}`],
    ['com chave de tamanho errado', `1:${randomBytes(16).toString('base64')}`],
  ])('rejeita a configuração %s', (_case, value) => {
    expect(schema.safeParse({ keys: value }).success).toBe(false);
  });

  it('rejeita a versão repetida', () => {
    const material = buildKey();

    const result = schema.safeParse({ keys: `1:${material},1:${buildKey()}` });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/versão de chave 1 repet/);
  });
});

describe('singleKey', () => {
  const schema = z.object({ key: singleKey() });

  it.each([
    ['base64', buildKey],
    ['hexadecimal', buildHexKey],
  ])('aceita uma chave em %s', (_encoding, build) => {
    expect(schema.parse({ key: build() }).key).toHaveLength(KEY_LENGTH_BYTES);
  });

  it.each([
    ['vazia', ''],
    ['de tamanho errado', randomBytes(31).toString('base64')],
    ['com versão', `1:${buildKey()}`],
  ])('rejeita uma chave %s', (_case, value) => {
    expect(schema.safeParse({ key: value }).success).toBe(false);
  });
});
