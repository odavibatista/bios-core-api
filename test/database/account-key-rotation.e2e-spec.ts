import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { decodeKey } from '@shared/config/encryption.config.js';
import type { Environment } from '@shared/config/environment.config.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { AesEncryptionProvider } from '@shared/infra/providers/aes-encryption.provider.js';
import { BcryptPasswordProvider } from '@shared/infra/providers/bcrypt-password.provider.js';
import { OpaqueTokenProvider } from '@shared/domain/providers/opaque-token.provider.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { UserTokenPurpose } from '@prisma/client';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { Queue } from 'bullmq';
import request from 'supertest';
import { inject } from 'vitest';
import { buildKey } from '../factories/shared/encryption-key.factory.js';
import { buildPassword } from '../factories/shared/password.factory.js';
import { faker } from '../support/faker.js';
import { resetThrottleCounters } from '../support/throttle.js';
import { testRedisUrl } from '../support/infrastructure.js';

const REDIS_URL = testRedisUrl();

/** Chave 1 do ambiente de teste (vitest.config.e2e.ts). */
const KEY_V1 = `${'e'.repeat(43)}=`;
const BLIND_INDEX_KEY = `${'b'.repeat(43)}=`;

/**
 * Escritas na conta com a chave de cifragem rotacionada, contra o MongoDB real.
 *
 * O documento do usuário tem uma única `encryption_key_version` para e-mail,
 * endereço e senha. Com a chave ativa já na versão 2 e a conta ainda na 1,
 * gravar só a senha nova deixaria o documento ilegível; a troca precisa recifrar
 * tudo junto.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Conta com rotação da chave de cifragem (e2e)',
  () => {
    const keyV2 = buildKey();
    const originalKeys = process.env.ENCRYPTION_KEYS;
    let app: INestApplication;
    let prisma: PrismaService;
    let encryption: EncryptionProvider;
    let opaqueTokens: OpaqueTokenProvider;

    /** Provider ligado só à versão 1, como era antes da rotação. */
    function legacyProviders() {
      const config = {
        get: (key: keyof Environment) =>
          ({
            ENCRYPTION_KEYS: {
              activeVersion: 1,
              keys: new Map([[1, decodeKey(KEY_V1)!]]),
            },
            BLIND_INDEX_KEY: decodeKey(BLIND_INDEX_KEY)!,
            BCRYPT_COST: 4,
          })[key as string],
      } as unknown as ConfigService<Environment, true>;
      const aes = new AesEncryptionProvider(config);

      return { aes, passwords: new BcryptPasswordProvider(config, aes) };
    }

    beforeAll(async () => {
      // A aplicação sobe com as versões 1 e 2: a 2 é a ativa. O ambiente é
      // validado no momento em que o AppModule é importado, então a variável
      // precisa estar definida antes e o import tem de ser dinâmico.
      process.env.ENCRYPTION_KEYS = `1:${KEY_V1},2:${keyV2}`;
      const { createDatabaseTestingApp } =
        await import('../support/database-testing-app.js');
      ({ app, prisma } = await createDatabaseTestingApp());
      encryption = app.get(EncryptionProvider);
      opaqueTokens = app.get(OpaqueTokenProvider);
    });

    beforeEach(async () => {
      await resetThrottleCounters(REDIS_URL);
    });

    afterEach(async () => {
      await prisma.reset([
        'users',
        'user_sessions',
        'user_tokens',
        'login_attempts',
      ]);
    });

    afterAll(async () => {
      process.env.ENCRYPTION_KEYS = originalKeys;
      const queue = new Queue(QueueName.EMAIL_DISPATCH, {
        connection: { url: REDIS_URL },
      });
      await queue.obliterate({ force: true });
      await queue.close();
      await app.close();
    });

    /** Conta gravada ainda na versão 1 da chave, com endereço. */
    async function createLegacyAccount() {
      const { aes, passwords } = legacyProviders();
      const email = faker.internet.email().toLowerCase();
      const address = faker.location.streetAddress({ useFullAddress: true });
      const password = buildPassword();
      const passwordEncrypted = await passwords.hash(password);

      const { id_user } = await prisma.user.create({
        data: {
          user_name: faker.person.fullName(),
          email_encrypted: aes.encrypt(email).ciphertext,
          email_hash: aes.blindIndex(email),
          password_encrypted: passwordEncrypted.ciphertext,
          address_encrypted: aes.encrypt(address).ciphertext,
          encryption_key_version: 1,
          is_active: true,
        },
      });

      return { id: id_user, email, address, password };
    }

    const login = (email: string, password: string) =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password });

    it('a aplicação sobe com a chave 2 ativa', () => {
      expect(encryption.activeKeyVersion).toBe(2);
    });

    it('a conta antiga entra normalmente, ainda na versão 1', async () => {
      const account = await createLegacyAccount();

      await login(account.email, account.password).expect(200);
    });

    it('trocar a senha leva todos os campos cifrados à versão 2, ainda legíveis', async () => {
      const account = await createLegacyAccount();
      const { body } = await login(account.email, account.password).expect(200);
      const newPassword = buildPassword();

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${body.access_token as string}`)
        .send({
          current_password: account.password,
          new_password: newPassword,
        })
        .expect(204);

      const user = await prisma.user.findUniqueOrThrow({
        where: { id_user: account.id },
      });
      expect(user.encryption_key_version).toBe(2);
      expect(
        encryption.decrypt({ ciphertext: user.email_encrypted, keyVersion: 2 }),
      ).toBe(account.email);
      expect(
        encryption.decrypt({
          ciphertext: user.address_encrypted!,
          keyVersion: 2,
        }),
      ).toBe(account.address);
      await login(account.email, newPassword).expect(200);
    });

    it('editar o endereço também leva todos os campos à versão 2', async () => {
      const account = await createLegacyAccount();
      const { body } = await login(account.email, account.password).expect(200);
      const address = {
        postal_code: '01310-100',
        street: 'Avenida Paulista',
        number: '1578',
        neighborhood: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
      };

      await request(app.getHttpServer())
        .patch('/accounts/me')
        .set('Authorization', `Bearer ${body.access_token as string}`)
        .send({ address })
        .expect(200);

      const user = await prisma.user.findUniqueOrThrow({
        where: { id_user: account.id },
      });
      expect(user.encryption_key_version).toBe(2);
      expect(
        encryption.decrypt({ ciphertext: user.email_encrypted, keyVersion: 2 }),
      ).toBe(account.email);
      expect(
        encryption.decrypt({
          ciphertext: user.address_encrypted!,
          keyVersion: 2,
        }),
      ).toContain('Avenida Paulista');
      // A senha também foi recifrada: o login continua funcionando.
      await login(account.email, account.password).expect(200);
    });

    it('confirma a troca de e-mail de um link emitido com a chave 1, já com a chave 2 ativa', async () => {
      const account = await createLegacyAccount();
      const newEmail = faker.internet.email().toLowerCase();
      const token = faker.string.alphanumeric(43);
      const { aes } = legacyProviders();
      // O link foi emitido antes da rotação: o e-mail pendente está na chave 1.
      await prisma.userToken.create({
        data: {
          user_id: account.id,
          purpose: UserTokenPurpose.EMAIL_CHANGE,
          token_hash: opaqueTokens.hash(token),
          pending_email_encrypted: `1:${aes.encrypt(newEmail).ciphertext}`,
          expires_at: faker.date.soon(),
        },
      });

      await request(app.getHttpServer())
        .post('/accounts/confirm-email-change')
        .send({ token })
        .expect(200);

      const user = await prisma.user.findUniqueOrThrow({
        where: { id_user: account.id },
      });
      expect(user.encryption_key_version).toBe(2);
      expect(user.email_hash).toBe(encryption.blindIndex(newEmail));
      expect(
        encryption.decrypt({ ciphertext: user.email_encrypted, keyVersion: 2 }),
      ).toBe(newEmail);
      expect(
        encryption.decrypt({
          ciphertext: user.address_encrypted!,
          keyVersion: 2,
        }),
      ).toBe(account.address);
      await login(newEmail, account.password).expect(200);
    });
  },
);
