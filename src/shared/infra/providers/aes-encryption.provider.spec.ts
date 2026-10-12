import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import {
  buildKey,
  buildSensitiveValue,
} from '@test/factories/shared/encryption-key.factory.js';
import { faker } from '@test/support/faker.js';
import {
  type EncryptionKeyring,
  decodeKey,
} from '../../config/encryption.config.js';
import type { Environment } from '../../config/environment.config.js';
import { EncryptionException } from '../../domain/errors/encryption.exception.js';
import { AesEncryptionProvider } from './aes-encryption.provider.js';

/** Provider com as versões de chave informadas (padrão: só a versão 1). */
function createProvider(versions: number[] = [1]): AesEncryptionProvider {
  const keys = new Map(
    versions.map((version) => [version, decodeKey(buildKey())!]),
  );
  const values: Pick<Environment, 'ENCRYPTION_KEYS' | 'BLIND_INDEX_KEY'> = {
    ENCRYPTION_KEYS: {
      activeVersion: Math.max(...versions),
      keys,
    } satisfies EncryptionKeyring,
    BLIND_INDEX_KEY: decodeKey(buildKey())!,
  };
  const configService = {
    get: (key: keyof typeof values) => values[key],
  } as unknown as ConfigService<Environment, true>;

  return new AesEncryptionProvider(configService);
}

/**
 * Motivo técnico registrado em `details`. A mensagem da exceção é genérica de
 * propósito: o motivo serve ao log, não ao consumidor da API.
 */
function reasonOf(attempt: () => unknown): string {
  try {
    attempt();
  } catch (error) {
    expect(error).toBeInstanceOf(EncryptionException);
    const { details } = error as EncryptionException;

    return (details as { reason: string }).reason;
  }

  return expect.unreachable('a operação deveria ter falhado');
}

describe('AesEncryptionProvider', () => {
  describe('cifragem e decifragem', () => {
    it('devolve o valor original', () => {
      const provider = createProvider();
      const value = buildSensitiveValue();

      expect(provider.decrypt(provider.encrypt(value))).toBe(value);
    });

    it('preserva acentuação e caracteres fora do ASCII', () => {
      const provider = createProvider();
      const value = `${faker.person.fullName()} — ${faker.location.city()}, ação`;

      expect(provider.decrypt(provider.encrypt(value))).toBe(value);
    });

    it('produz textos diferentes para o mesmo valor (IV aleatório)', () => {
      const provider = createProvider();
      const value = buildSensitiveValue();

      const first = provider.encrypt(value);
      const second = provider.encrypt(value);

      expect(first.ciphertext).not.toBe(second.ciphertext);
      expect(provider.decrypt(second)).toBe(value);
    });

    it('cifra com a versão ativa e a informa no resultado', () => {
      const provider = createProvider([1, 2, 7]);

      expect(provider.activeKeyVersion).toBe(7);
      expect(provider.encrypt(buildSensitiveValue()).keyVersion).toBe(7);
    });

    it('não expõe o valor em claro no texto cifrado', () => {
      const provider = createProvider();
      const value = faker.internet.email();

      const { ciphertext } = provider.encrypt(value);

      expect(ciphertext).not.toContain(value);
      expect(
        Buffer.from(ciphertext, 'base64url').toString('utf8'),
      ).not.toContain(value);
    });
  });

  describe('rotação de chave', () => {
    it('decifra um valor da versão anterior depois que a ativa avança', () => {
      const keys = new Map([
        [1, decodeKey(buildKey())!],
        [2, decodeKey(buildKey())!],
      ]);
      const blindIndexKey = decodeKey(buildKey())!;
      const providerWith = (activeVersion: number) =>
        new AesEncryptionProvider({
          get: (key: string) =>
            key === 'ENCRYPTION_KEYS'
              ? ({ activeVersion, keys } satisfies EncryptionKeyring)
              : blindIndexKey,
        } as unknown as ConfigService<Environment, true>);
      const value = buildSensitiveValue();

      const encrypted = providerWith(1).encrypt(value);
      const afterRotation = providerWith(2);

      expect(encrypted.keyVersion).toBe(1);
      expect(afterRotation.decrypt(encrypted)).toBe(value);
      expect(afterRotation.encrypt(value).keyVersion).toBe(2);
    });

    it('recusa um valor cifrado com versão não configurada', () => {
      const provider = createProvider([1]);
      const encrypted = provider.encrypt(buildSensitiveValue());

      const attempt = () => provider.decrypt({ ...encrypted, keyVersion: 99 });

      expect(attempt).toThrow(EncryptionException);
      expect(reasonOf(attempt)).toMatch(
        /versão de chave 99 não está configurada/,
      );
    });
  });

  describe('integridade', () => {
    it('recusa o texto adulterado', () => {
      const provider = createProvider();
      const { ciphertext, keyVersion } = provider.encrypt(
        buildSensitiveValue(),
      );
      const payload = Buffer.from(ciphertext, 'base64url');
      payload[payload.length - 1] ^= 0xff;

      expect(() =>
        provider.decrypt({
          ciphertext: payload.toString('base64url'),
          keyVersion,
        }),
      ).toThrow(EncryptionException);
    });

    it('recusa a tag de autenticação adulterada', () => {
      const provider = createProvider();
      const { ciphertext, keyVersion } = provider.encrypt(
        buildSensitiveValue(),
      );
      const payload = Buffer.from(ciphertext, 'base64url');
      // Byte 12: primeiro da tag, logo após o IV.
      payload[12] ^= 0xff;

      expect(() =>
        provider.decrypt({
          ciphertext: payload.toString('base64url'),
          keyVersion,
        }),
      ).toThrow(EncryptionException);
    });

    it('recusa o texto truncado', () => {
      const provider = createProvider();

      expect(
        reasonOf(() =>
          provider.decrypt({
            ciphertext: randomBytes(20).toString('base64url'),
            keyVersion: 1,
          }),
        ),
      ).toMatch(/truncado/);
    });

    it('recusa um valor cifrado com outra chave da mesma versão', () => {
      const encrypted = createProvider().encrypt(buildSensitiveValue());

      expect(reasonOf(() => createProvider().decrypt(encrypted))).toMatch(
        /integridade/,
      );
    });

    it('responde sempre a mesma mensagem genérica, sem o motivo nem o valor', () => {
      const provider = createProvider();
      const motives = [
        () => provider.decrypt({ ciphertext: 'x', keyVersion: 1 }),
        () =>
          provider.decrypt({
            ...provider.encrypt(buildSensitiveValue()),
            keyVersion: 99,
          }),
      ];

      for (const attempt of motives) {
        expect(attempt).toThrow(
          'Não foi possível processar um dado protegido.',
        );
      }
    });
  });

  describe('índice cego', () => {
    it('é determinístico para o mesmo valor', () => {
      const provider = createProvider();
      const value = faker.internet.email();

      expect(provider.blindIndex(value)).toBe(provider.blindIndex(value));
    });

    it('ignora caixa e espaços nas bordas', () => {
      const provider = createProvider();
      const email = faker.internet.email().toLowerCase();

      expect(provider.blindIndex(`  ${email.toUpperCase()} `)).toBe(
        provider.blindIndex(email),
      );
    });

    it('difere entre valores diferentes', () => {
      const provider = createProvider();
      const [first, second] = faker.helpers.uniqueArray(
        () => faker.internet.email().toLowerCase(),
        2,
      );

      expect(provider.blindIndex(first)).not.toBe(provider.blindIndex(second));
    });

    it('difere entre instalações com chaves distintas', () => {
      const email = faker.internet.email();

      expect(createProvider().blindIndex(email)).not.toBe(
        createProvider().blindIndex(email),
      );
    });

    it('não contém o valor de origem', () => {
      const provider = createProvider();
      const email = faker.internet.email().toLowerCase();

      expect(provider.blindIndex(email)).not.toContain(email.split('@')[0]);
    });
  });
});
