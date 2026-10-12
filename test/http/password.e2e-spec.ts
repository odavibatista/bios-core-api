import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRounds } from 'bcryptjs';
import { validateEnvironment } from '@shared/config/environment.config.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { PasswordProvider } from '@shared/domain/providers/password.provider.js';
import { EncryptionModule } from '@shared/infra/modules/encryption.module.js';
import {
  buildKey,
  buildKeyring,
} from '../factories/shared/encryption-key.factory.js';
import { buildPassword } from '../factories/shared/password.factory.js';

/**
 * Monta o módulo de criptografia com a configuração real (variáveis validadas
 * pelo `ConfigModule`), para provar que os dois providers chegam aos
 * consumidores já configurados e falando entre si.
 */
async function createProviders(environment: Record<string, string>): Promise<{
  passwords: PasswordProvider;
  encryption: EncryptionProvider;
}> {
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

  return {
    passwords: moduleRef.get(PasswordProvider),
    encryption: moduleRef.get(EncryptionProvider),
  };
}

describe('Senha em duas camadas (e2e)', () => {
  const baseEnvironment = {
    DATABASE_URL: 'mongodb://localhost:27017/bios_test?directConnection=true',
    ENCRYPTION_KEYS: buildKeyring(),
    BLIND_INDEX_KEY: buildKey(),
    // Custo mínimo: a suíte verifica a montagem do módulo, não a dureza.
    BCRYPT_COST: '4',
  };

  it('injeta o provider pelo contrato de domínio e fecha o ciclo da senha', async () => {
    const { passwords } = await createProviders(baseEnvironment);
    const password = buildPassword();

    const stored = await passwords.hash(password);

    await expect(passwords.verify(password, stored)).resolves.toBe(true);
    await expect(passwords.verify(buildPassword(), stored)).resolves.toBe(
      false,
    );
  });

  it('grava o hash sob a chave ativa do ambiente', async () => {
    const { passwords, encryption } = await createProviders(baseEnvironment);

    const stored = await passwords.hash(buildPassword());

    // O mesmo chaveiro do módulo abre o valor: é uma camada, não dois sistemas.
    expect(stored.keyVersion).toBe(encryption.activeKeyVersion);
    expect(encryption.decrypt(stored)).toMatch(/^\$2[aby]\$/);
  });

  it('aplica o custo configurado no ambiente', async () => {
    const cost = 5;
    const { passwords, encryption } = await createProviders({
      ...baseEnvironment,
      BCRYPT_COST: String(cost),
    });

    const stored = await passwords.hash(buildPassword());

    expect(getRounds(encryption.decrypt(stored))).toBe(cost);
  });

  it('impede a aplicação de subir com custo fora dos limites do bcrypt', async () => {
    await expect(
      createProviders({ ...baseEnvironment, BCRYPT_COST: '99' }),
    ).rejects.toThrow(/BCRYPT_COST/);
  });
});
