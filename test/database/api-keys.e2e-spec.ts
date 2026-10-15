import type { INestApplication } from '@nestjs/common';
import { MAX_ACTIVE_API_KEYS_PER_USER } from '@modules/api-keys/infra/usecases/create-api-key.usecase.js';
import {
  type ErrorResponse,
  ErrorResponseSchema,
} from '@shared/domain/dtos/errors/error-response.dto.js';
import { OpaqueTokenProvider } from '@shared/domain/providers/opaque-token.provider.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import request from 'supertest';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { faker } from '../support/faker.js';
import {
  createTestAccount,
  type TestAccount,
} from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';

const REDIS_URL = inject('testRedisUrl');

const API_KEY_FORMAT = /^bios_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{43}$/;

/** Identificadores, na ordem, do corpo de uma listagem de chaves. */
function idsOf(body: { data: { id: string }[] }): string[] {
  return body.data.map(({ id }) => id);
}

/**
 * Manutenção das chaves de API contra banco e Redis reais (UC11): geração com
 * exibição única, listagem sem segredo, revogação restrita ao dono e teto de
 * chaves ativas. As sessões são abertas pelo login real.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Chaves de API (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let opaqueTokens: OpaqueTokenProvider;

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
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
        'access_blocks',
        'api_keys',
      ]);
    });

    afterAll(async () => {
      await app.close();
    });

    /** Abre uma sessão pelo login real e devolve o access token. */
    async function signIn(account: TestAccount): Promise<string> {
      const { body } = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);

      return body.access_token as string;
    }

    async function signedInAccount(): Promise<{
      account: TestAccount;
      accessToken: string;
    }> {
      const account = await createTestAccount(app);

      return { account, accessToken: await signIn(account) };
    }

    function authed(
      method: 'get' | 'post' | 'delete',
      path: string,
      accessToken: string | undefined,
      body?: Record<string, unknown>,
    ) {
      const call = request(app.getHttpServer())[method](path);
      const withToken = accessToken
        ? call.set('Authorization', `Bearer ${accessToken}`)
        : call;

      return body ? withToken.send(body) : withToken;
    }

    const createKey = (accessToken: string, name = 'Integração com o CRM') =>
      authed('post', '/api-keys', accessToken, { name });

    describe('POST /api-keys', () => {
      it('201: devolve a chave completa uma única vez, no formato esperado', async () => {
        const { account, accessToken } = await signedInAccount();

        const response = await createKey(accessToken, 'Meu CRM').expect(201);

        expect(response.body).toEqual({
          id: expect.stringMatching(/^[0-9a-f]{24}$/),
          name: 'Meu CRM',
          prefix: expect.stringMatching(/^bios_[A-Za-z0-9]{8}$/),
          key: expect.stringMatching(API_KEY_FORMAT),
          created_at: expect.any(String),
          last_used_at: null,
        });
        expect(
          (response.body.key as string).startsWith(response.body.prefix),
        ).toBe(true);

        const stored = await prisma.apiKey.findUniqueOrThrow({
          where: { id_api_key: response.body.id },
        });
        expect(stored.user_id).toBe(account.id);
      });

      it('grava só o resumo da chave: o valor completo não está no banco', async () => {
        const { accessToken } = await signedInAccount();

        const { body } = await createKey(accessToken).expect(201);

        const stored = await prisma.apiKey.findUniqueOrThrow({
          where: { id_api_key: body.id },
        });
        expect(stored.key_hash).toBe(opaqueTokens.hash(body.key));
        expect(stored.key_hash).not.toBe(body.key);
        expect(stored.key_prefix).toBe(body.prefix);
        expect(JSON.stringify(stored)).not.toContain(body.key);
        expect(stored.revoked_at ?? null).toBeNull();
      });

      it('gera chaves diferentes para o mesmo usuário', async () => {
        const { accessToken } = await signedInAccount();

        const first = await createKey(accessToken, 'Primeira').expect(201);
        const second = await createKey(accessToken, 'Segunda').expect(201);

        expect(first.body.key).not.toBe(second.body.key);
        expect(first.body.prefix).not.toBe(second.body.prefix);
      });

      it('422: recusa nome ausente, curto ou longo demais', async () => {
        const { accessToken } = await signedInAccount();

        for (const body of [{}, { name: 'A' }, { name: 'a'.repeat(61) }]) {
          await authed('post', '/api-keys', accessToken, body).expect(422);
        }
        expect(await prisma.apiKey.count()).toBe(0);
      });

      it('401: recusa sem sessão', async () => {
        await createKey(undefined as unknown as string).expect(401);

        expect(await prisma.apiKey.count()).toBe(0);
      });

      it(`422: recusa a chave seguinte ao teto de ${MAX_ACTIVE_API_KEYS_PER_USER} ativas`, async () => {
        const { accessToken } = await signedInAccount();
        for (let i = 0; i < MAX_ACTIVE_API_KEYS_PER_USER; i += 1) {
          await createKey(accessToken, `Chave ${i}`).expect(201);
        }

        const response = await createKey(accessToken, 'Excedente').expect(422);

        const error = ErrorResponseSchema.parse(response.body);
        expect(error.code).toBe('API_KEY_LIMIT_REACHED');
        expect(error.details).toEqual({ limit: MAX_ACTIVE_API_KEYS_PER_USER });
        expect(await prisma.apiKey.count()).toBe(MAX_ACTIVE_API_KEYS_PER_USER);
      });

      it('revogar uma chave libera a vaga no teto', async () => {
        const { accessToken } = await signedInAccount();
        const created: string[] = [];
        for (let i = 0; i < MAX_ACTIVE_API_KEYS_PER_USER; i += 1) {
          const { body } = await createKey(accessToken, `Chave ${i}`).expect(
            201,
          );
          created.push(body.id);
        }
        await authed('delete', `/api-keys/${created[0]}`, accessToken).expect(
          204,
        );

        await createKey(accessToken, 'Nova').expect(201);
      });

      it('o teto é por usuário: as chaves de um não ocupam a vaga de outro', async () => {
        const first = await signedInAccount();
        const second = await signedInAccount();
        for (let i = 0; i < MAX_ACTIVE_API_KEYS_PER_USER; i += 1) {
          await createKey(first.accessToken, `Chave ${i}`).expect(201);
        }

        await createKey(second.accessToken).expect(201);
      });
    });

    describe('GET /api-keys', () => {
      it('200: lista as chaves ativas do usuário, da mais nova para a mais antiga', async () => {
        const { accessToken } = await signedInAccount();
        const older = await createKey(accessToken, 'Mais antiga').expect(201);
        await new Promise((resolve) => setTimeout(resolve, 20));
        const newer = await createKey(accessToken, 'Mais nova').expect(201);

        const response = await authed('get', '/api-keys', accessToken).expect(
          200,
        );

        expect(idsOf(response.body)).toEqual([newer.body.id, older.body.id]);
        expect(response.body.data[0]).toEqual({
          id: newer.body.id,
          name: 'Mais nova',
          prefix: newer.body.prefix,
          created_at: expect.any(String),
          last_used_at: null,
        });
      });

      it('nunca devolve o valor da chave nem o seu resumo', async () => {
        const { accessToken } = await signedInAccount();
        const { body: created } = await createKey(accessToken).expect(201);

        const response = await authed('get', '/api-keys', accessToken).expect(
          200,
        );

        const text = JSON.stringify(response.body);
        expect(text).not.toContain(created.key);
        expect(text).not.toContain(opaqueTokens.hash(created.key));
        expect(text).not.toContain('key_hash');
        expect(Object.keys(response.body.data[0])).not.toContain('key');
      });

      it('200: lista vazia quando o usuário não tem chaves', async () => {
        const { accessToken } = await signedInAccount();

        const response = await authed('get', '/api-keys', accessToken).expect(
          200,
        );

        expect(response.body).toEqual({ data: [] });
      });

      it('não mostra as chaves revogadas', async () => {
        const { accessToken } = await signedInAccount();
        const kept = await createKey(accessToken, 'Mantida').expect(201);
        const dropped = await createKey(accessToken, 'Revogada').expect(201);
        await authed(
          'delete',
          `/api-keys/${dropped.body.id}`,
          accessToken,
        ).expect(204);

        const response = await authed('get', '/api-keys', accessToken).expect(
          200,
        );

        expect(idsOf(response.body)).toEqual([kept.body.id]);
      });

      it('não mostra as chaves de outros usuários', async () => {
        const owner = await signedInAccount();
        const other = await signedInAccount();
        await createKey(owner.accessToken).expect(201);

        const response = await authed(
          'get',
          '/api-keys',
          other.accessToken,
        ).expect(200);

        expect(response.body).toEqual({ data: [] });
      });

      it('reflete o último uso gravado na chave', async () => {
        const { accessToken } = await signedInAccount();
        const { body: created } = await createKey(accessToken).expect(201);
        const usedAt = faker.date.recent();
        await prisma.apiKey.update({
          where: { id_api_key: created.id },
          data: { last_used_at: usedAt },
        });

        const response = await authed('get', '/api-keys', accessToken).expect(
          200,
        );

        expect(response.body.data[0].last_used_at).toBe(usedAt.toISOString());
      });

      it('401: recusa sem sessão', async () => {
        await authed('get', '/api-keys', undefined).expect(401);
      });
    });

    describe('DELETE /api-keys/:id', () => {
      it('204: revoga a chave, que some da listagem e fica marcada no banco', async () => {
        const { accessToken } = await signedInAccount();
        const { body: created } = await createKey(accessToken).expect(201);

        await authed('delete', `/api-keys/${created.id}`, accessToken).expect(
          204,
        );

        const stored = await prisma.apiKey.findUniqueOrThrow({
          where: { id_api_key: created.id },
        });
        expect(stored.revoked_at).toBeInstanceOf(Date);
        const list = await authed('get', '/api-keys', accessToken).expect(200);
        expect(list.body).toEqual({ data: [] });
      });

      it('404: revogar de novo a mesma chave', async () => {
        const { accessToken } = await signedInAccount();
        const { body: created } = await createKey(accessToken).expect(201);
        await authed('delete', `/api-keys/${created.id}`, accessToken).expect(
          204,
        );

        const response = await authed(
          'delete',
          `/api-keys/${created.id}`,
          accessToken,
        ).expect(404);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'API_KEY_NOT_FOUND',
        );
      });

      it('404 idêntico para chave de outro usuário, inexistente e malformada', async () => {
        const owner = await signedInAccount();
        const intruder = await signedInAccount();
        const { body: created } = await createKey(owner.accessToken).expect(
          201,
        );

        const bodies: ErrorResponse[] = [];
        for (const id of [
          created.id,
          faker.database.mongodbObjectId(),
          'nao-e-um-id',
        ]) {
          const response = await authed(
            'delete',
            `/api-keys/${id}`,
            intruder.accessToken,
          ).expect(404);
          bodies.push(ErrorResponseSchema.parse(response.body));
        }

        // `path` e `timestamp` variam por requisição; o restante tem de ser igual.
        const [first, ...rest] = bodies.map(
          ({ statusCode, code, message, details }) => ({
            statusCode,
            code,
            message,
            details,
          }),
        );
        for (const body of rest) expect(body).toEqual(first);
        const untouched = await prisma.apiKey.findUniqueOrThrow({
          where: { id_api_key: created.id },
        });
        expect(untouched.revoked_at ?? null).toBeNull();
      });

      it('401: recusa sem sessão e não revoga nada', async () => {
        const { accessToken } = await signedInAccount();
        const { body: created } = await createKey(accessToken).expect(201);

        await authed('delete', `/api-keys/${created.id}`, undefined).expect(
          401,
        );

        const stored = await prisma.apiKey.findUniqueOrThrow({
          where: { id_api_key: created.id },
        });
        expect(stored.revoked_at ?? null).toBeNull();
      });
    });
  },
);
