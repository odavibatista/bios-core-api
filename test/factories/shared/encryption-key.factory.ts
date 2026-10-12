import { randomBytes } from 'node:crypto';
import { KEY_LENGTH_BYTES } from '@shared/config/encryption.config.js';
import { faker } from '../../support/faker.js';

/** Chave de 32 bytes em base64, no formato aceito pelas variáveis de ambiente. */
export function buildKey(): string {
  return randomBytes(KEY_LENGTH_BYTES).toString('base64');
}

/** Chave de 32 bytes em hexadecimal, a codificação alternativa aceita. */
export function buildHexKey(): string {
  return randomBytes(KEY_LENGTH_BYTES).toString('hex');
}

/**
 * Valor de `ENCRYPTION_KEYS` com as versões informadas (padrão: só a versão 1).
 */
export function buildKeyring(versions: number[] = [1]): string {
  return versions.map((version) => `${version}:${buildKey()}`).join(',');
}

/** Valor sensível de exemplo, do tamanho e formato dos dados cifrados em produção. */
export function buildSensitiveValue(): string {
  return faker.helpers.arrayElement([
    faker.internet.email(),
    faker.location.streetAddress({ useFullAddress: true }),
    faker.string.alphanumeric({ length: { min: 1, max: 512 } }),
  ]);
}
