import type { ConfigService } from '@nestjs/config';
import { getRounds, truncates } from 'bcryptjs';
import { buildKey } from '@test/factories/shared/encryption-key.factory.js';
import {
  BCRYPT_INPUT_LIMIT,
  buildCollidingLongPasswords,
  buildPassword,
} from '@test/factories/shared/password.factory.js';
import { faker } from '@test/support/faker.js';
import {
  type EncryptionKeyring,
  decodeKey,
} from '../../config/encryption.config.js';
import type { Environment } from '../../config/environment.config.js';
import { EncryptionException } from '../../domain/errors/encryption.exception.js';
import { AesEncryptionProvider } from './aes-encryption.provider.js';
import { BcryptPasswordProvider } from './bcrypt-password.provider.js';

/** Custo mínimo do bcrypt: as suítes verificam comportamento, não dureza. */
const TEST_COST = 4;

function configOf(
  values: Partial<Environment>,
): ConfigService<Environment, true> {
  return {
    get: (key: keyof Environment) => values[key],
  } as unknown as ConfigService<Environment, true>;
}

/**
 * Provider de senha sobre criptografia real, com chaves próprias a cada
 * chamada: duas instalações nunca leem o dado uma da outra.
 */
function createProvider(cost = TEST_COST): {
  passwords: BcryptPasswordProvider;
  encryption: AesEncryptionProvider;
} {
  const configService = configOf({
    ENCRYPTION_KEYS: {
      activeVersion: 1,
      keys: new Map([[1, decodeKey(buildKey())!]]),
    } satisfies EncryptionKeyring,
    BLIND_INDEX_KEY: decodeKey(buildKey())!,
    BCRYPT_COST: cost,
  });
  const encryption = new AesEncryptionProvider(configService);

  return {
    passwords: new BcryptPasswordProvider(configService, encryption),
    encryption,
  };
}

describe('BcryptPasswordProvider', () => {
  describe('hash e verificação', () => {
    it('aceita a senha correta', async () => {
      const { passwords } = createProvider();
      const password = buildPassword();

      const stored = await passwords.hash(password);

      await expect(passwords.verify(password, stored)).resolves.toBe(true);
    });

    it('recusa a senha incorreta', async () => {
      const { passwords } = createProvider();
      const [password, other] = faker.helpers.uniqueArray(buildPassword, 2);

      const stored = await passwords.hash(password);

      await expect(passwords.verify(other, stored)).resolves.toBe(false);
    });

    it('diferencia a caixa dos caracteres', async () => {
      const { passwords } = createProvider();
      const password = `${buildPassword()}aA`;

      const stored = await passwords.hash(password);

      await expect(
        passwords.verify(password.toUpperCase(), stored),
      ).resolves.toBe(false);
    });

    it('aceita senha com acentuação e caracteres fora do ASCII', async () => {
      const { passwords } = createProvider();
      const password = `Ação-${buildPassword()}-日本`;

      const stored = await passwords.hash(password);

      await expect(passwords.verify(password, stored)).resolves.toBe(true);
    });

    it('gera valores diferentes para a mesma senha (salt e IV próprios)', async () => {
      const { passwords } = createProvider();
      const password = buildPassword();

      const first = await passwords.hash(password);
      const second = await passwords.hash(password);

      expect(first.ciphertext).not.toBe(second.ciphertext);
      await expect(passwords.verify(password, first)).resolves.toBe(true);
      await expect(passwords.verify(password, second)).resolves.toBe(true);
    });
  });

  describe('duas camadas', () => {
    it('persiste o hash cifrado, nunca o hash em claro', async () => {
      const { passwords, encryption } = createProvider();

      const stored = await passwords.hash(buildPassword());

      // No banco fica o texto cifrado; o hash do bcrypt está por baixo dele.
      expect(stored.ciphertext).not.toMatch(/^\$2[aby]\$/);
      expect(encryption.decrypt(stored)).toMatch(/^\$2[aby]\$/);
      expect(stored.keyVersion).toBe(encryption.activeKeyVersion);
    });

    it('não expõe a senha em claro no valor persistido', async () => {
      const { passwords } = createProvider();
      const password = buildPassword();

      const { ciphertext } = await passwords.hash(password);

      expect(ciphertext).not.toContain(password);
      expect(
        Buffer.from(ciphertext, 'base64url').toString('utf8'),
      ).not.toContain(password);
    });

    it('recusa o valor adulterado em vez de tratá-lo como senha errada', async () => {
      const { passwords } = createProvider();
      const password = buildPassword();
      const stored = await passwords.hash(password);
      const payload = Buffer.from(stored.ciphertext, 'base64url');
      payload[payload.length - 1] ^= 0xff;

      // Problema de integridade não é credencial inválida: tem de estourar.
      await expect(
        passwords.verify(password, {
          ...stored,
          ciphertext: payload.toString('base64url'),
        }),
      ).rejects.toThrow(EncryptionException);
    });

    it('recusa o valor cifrado com versão de chave não configurada', async () => {
      const { passwords } = createProvider();
      const stored = await passwords.hash(buildPassword());

      await expect(
        passwords.verify(buildPassword(), { ...stored, keyVersion: 99 }),
      ).rejects.toThrow(EncryptionException);
    });

    it('não lê o valor gravado por outra instalação', async () => {
      const password = buildPassword();
      const stored = await createProvider().passwords.hash(password);

      await expect(
        createProvider().passwords.verify(password, stored),
      ).rejects.toThrow(EncryptionException);
    });
  });

  describe('limite de 72 bytes do bcrypt', () => {
    it('distingue senhas longas que só diferem depois do limite', async () => {
      const { passwords } = createProvider();
      const [password, almostEqual] = buildCollidingLongPasswords();

      const stored = await passwords.hash(password);

      // Sem o pré-hash, o bcrypt ignoraria a diferença e aceitaria as duas.
      expect(password.length).toBeGreaterThan(BCRYPT_INPUT_LIMIT);
      expect(truncates(password)).toBe(true);
      await expect(passwords.verify(password, stored)).resolves.toBe(true);
      await expect(passwords.verify(almostEqual, stored)).resolves.toBe(false);
    });

    it('entrega ao bcrypt uma entrada que ele não trunca', async () => {
      const { passwords, encryption } = createProvider();
      const [password] = buildCollidingLongPasswords();

      const digest = encryption.decrypt(await passwords.hash(password));

      // O que o bcrypt recebe é o resumo da senha, e o resumo cabe no limite.
      expect(truncates(digest)).toBe(false);
    });
  });

  describe('custo configurável', () => {
    it('aplica o custo da configuração ao hash gerado', async () => {
      const cost = faker.number.int({ min: 4, max: 6 });
      const { passwords, encryption } = createProvider(cost);

      const stored = await passwords.hash(buildPassword());

      expect(getRounds(encryption.decrypt(stored))).toBe(cost);
    });

    it('verifica senhas gravadas com um custo anterior', async () => {
      const password = buildPassword();
      const { passwords: before, encryption } = createProvider(TEST_COST);
      const stored = await before.hash(password);
      const after = new BcryptPasswordProvider(
        configOf({ BCRYPT_COST: TEST_COST + 2 }),
        encryption,
      );

      // Aumentar o custo não invalida o que já estava gravado.
      await expect(after.verify(password, stored)).resolves.toBe(true);
      expect(getRounds(encryption.decrypt(stored))).toBe(TEST_COST);
    });
  });
});
