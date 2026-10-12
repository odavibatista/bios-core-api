import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateEnvironment } from '@shared/config/environment.config.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { EncryptionModule } from '@shared/infra/modules/encryption.module.js';
import {
  buildKey,
  buildKeyring,
  buildSensitiveValue,
} from '../factories/shared/encryption-key.factory.js';

/**
 * Monta o módulo de criptografia com a configuração real (variáveis validadas
 * pelo `ConfigModule`), para provar que o provider chega aos consumidores já
 * com as chaves carregadas.
 */
async function createProvider(
  environment: Record<string, string>,
): Promise<EncryptionProvider> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => validateEnvironment(environment)],
      }),
      EncryptionModule,
    ],
  }).compile();

  return moduleRef.get(EncryptionProvider);
}

describe('Criptografia de dados sensíveis (e2e)', () => {
  const baseEnvironment = {
    DATABASE_URL: 'mongodb://localhost:27017/bios_test?directConnection=true',
    REDIS_URL: 'redis://localhost:6379/1',
    ENCRYPTION_KEYS: buildKeyring(),
    BLIND_INDEX_KEY: buildKey(),
  };

  it('injeta o provider pelo contrato de domínio, com as chaves do ambiente', async () => {
    const provider = await createProvider(baseEnvironment);
    const value = buildSensitiveValue();

    const encrypted = provider.encrypt(value);

    expect(provider.activeKeyVersion).toBe(1);
    expect(encrypted.keyVersion).toBe(1);
    expect(provider.decrypt(encrypted)).toBe(value);
    expect(provider.blindIndex(value)).toEqual(provider.blindIndex(value));
  });

  it('impede a aplicação de subir com chave inválida', async () => {
    await expect(
      createProvider({ ...baseEnvironment, ENCRYPTION_KEYS: '1:curta' }),
    ).rejects.toThrow(/ENCRYPTION_KEYS/);
  });

  it('impede a aplicação de subir sem as chaves', async () => {
    const { DATABASE_URL, REDIS_URL } = baseEnvironment;

    await expect(createProvider({ DATABASE_URL, REDIS_URL })).rejects.toThrow(
      /ENCRYPTION_KEYS/,
    );
  });
});
