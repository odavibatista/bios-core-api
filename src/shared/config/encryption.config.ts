import { z } from 'zod';

/** Tamanho exigido de cada chave, em bytes (AES-256 e HMAC-SHA256). */
export const KEY_LENGTH_BYTES = 32;

/** Chave de cifragem de uma versão. */
export interface EncryptionKey {
  version: number;
  key: Buffer;
}

/** Conjunto de chaves em uso e a versão ativa para novas cifragens. */
export interface EncryptionKeyring {
  activeVersion: number;
  keys: ReadonlyMap<number, Buffer>;
}

const KEY_ENTRY = /^(?<version>[1-9]\d{0,3}):(?<material>.+)$/;

/**
 * Decodifica uma chave de 32 bytes em base64 ou hexadecimal.
 *
 * A codificação é inferida pelo formato: 64 caracteres hexadecimais, ou base64
 * (com ou sem preenchimento). Devolve `undefined` quando o material não
 * decodifica para exatamente 32 bytes — o que cobre tanto codificação inválida
 * quanto chave de tamanho errado.
 */
export function decodeKey(material: string): Buffer | undefined {
  const text = material.trim();
  const encoding = /^[0-9a-f]{64}$/i.test(text) ? 'hex' : 'base64';
  const key = Buffer.from(text, encoding);

  return key.length === KEY_LENGTH_BYTES ? key : undefined;
}

/**
 * Variável com o conjunto de chaves AES: entradas `versão:material` separadas
 * por vírgula (ex.: `1:<base64>,2:<base64>`).
 *
 * Manter as versões anteriores é o que viabiliza a rotação gradual; a maior
 * versão informada é a ativa, usada nas novas cifragens.
 */
export function encryptionKeyring() {
  return z
    .string()
    .nonempty()
    .transform((text, context): EncryptionKeyring => {
      const keys = new Map<number, Buffer>();

      for (const entry of text.split(',')) {
        const groups = KEY_ENTRY.exec(entry.trim())?.groups;
        const key = groups && decodeKey(groups.material);

        if (!groups || !key) {
          context.addIssue({
            code: 'custom',
            message:
              'deve ser uma lista "versão:chave" separada por vírgula, com ' +
              `chaves de ${KEY_LENGTH_BYTES} bytes em base64 ou hexadecimal ` +
              '(ex.: 1:<base64>,2:<base64>)',
          });
          return z.NEVER;
        }

        const version = Number(groups.version);

        if (keys.has(version)) {
          context.addIssue({
            code: 'custom',
            message: `tem a versão de chave ${version} repetida`,
          });
          return z.NEVER;
        }

        keys.set(version, key);
      }

      return { activeVersion: Math.max(...keys.keys()), keys };
    });
}

/**
 * Variável com uma única chave de 32 bytes, em base64 ou hexadecimal.
 *
 * Usada no índice cego, que não é versionado: trocar essa chave invalidaria
 * todos os índices já gravados.
 */
export function singleKey() {
  return z
    .string()
    .nonempty()
    .transform((text, context): Buffer => {
      const key = decodeKey(text);

      if (!key) {
        context.addIssue({
          code: 'custom',
          message: `deve ser uma chave de ${KEY_LENGTH_BYTES} bytes em base64 ou hexadecimal`,
        });
        return z.NEVER;
      }

      return key;
    });
}
