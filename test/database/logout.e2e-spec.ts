import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionRevocationReason } from '@prisma/client';
import type { Environment } from '@shared/config/environment.config.js';
import { MailProvider } from '@modules/mailing/domain/providers/mail.provider.js';
import { ErrorResponseSchema } from '@shared/domain/dtos/errors/error-response.dto.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { OpaqueTokenProvider } from '@shared/domain/providers/opaque-token.provider.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { Queue } from 'bullmq';
import request from 'supertest';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { faker } from '../support/faker.js';
import {
  createTestAccount,
  type TestAccount,
} from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';
import { testRedisUrl } from '../support/infrastructure.js';

const REDIS_URL = testRedisUrl();

/** Transporte dublê no lugar do SMTP: registra o que foi "enviado". */
class RecordingMailProvider extends MailProvider {
  readonly sent: { to: string }[] = [];

  override send(message: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    this.sent.push({ to: message.to });

    return Promise.resolve();
  }
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Encerramento de sessão e guard de autenticação contra banco, Redis e fila
 * reais (UC03, NFSE05). As sessões são abertas pelo login real; o que se prova
 * aqui é que a revogação vale de imediato para os dois tokens.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Encerramento de sessão (e2e)',
  () => {
    const mailProvider = new RecordingMailProvider();
    let app: INestApplication;
    let prisma: PrismaService;
    let opaqueTokens: OpaqueTokenProvider;

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp((builder) => {
        builder.overrideProvider(MailProvider).useValue(mailProvider);
      }));
      opaqueTokens = app.get(OpaqueTokenProvider);
    });

    beforeEach(async () => {
      await resetThrottleCounters(REDIS_URL);
    });

    afterEach(async () => {
      mailProvider.sent.length = 0;
      await prisma.reset([
        'users',
        'user_sessions',
        'login_attempts',
        'access_blocks',
        'email_dispatch_logs',
      ]);
    });

    afterAll(async () => {
      const queue = new Queue(QueueName.EMAIL_DISPATCH, {
        connection: { url: REDIS_URL },
      });
      await queue.obliterate({ force: true });
      await queue.close();
      await app.close();
    });

    async function signIn(account: TestAccount): Promise<Tokens> {
      const { body } = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);

      return {
        accessToken: body.access_token as string,
        refreshToken: body.refresh_token as string,
      };
    }

    const logout = (accessToken?: string) => {
      const call = request(app.getHttpServer()).post('/auth/logout');

      return accessToken
        ? call.set('Authorization', `Bearer ${accessToken}`)
        : call;
    };

    const logoutAll = (accessToken: string) =>
      request(app.getHttpServer())
        .post('/auth/logout-all')
        .set('Authorization', `Bearer ${accessToken}`);

    const refresh = (refreshToken: string) =>
      request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken });

    async function activeSessionCount(userId: string): Promise<number> {
      return prisma.userSession.count({
        where: {
          user_id: userId,
          OR: [{ revoked_at: null }, { revoked_at: { isSet: false } }],
        },
      });
    }

    describe('dispositivo atual', () => {
      it('204: encerra a sessão', async () => {
        const account = await createTestAccount(app);
        const { accessToken } = await signIn(account);

        await logout(accessToken).expect(204);
      });

      it('o access token deixa de valer na requisição seguinte, sem esperar o vencimento', async () => {
        const account = await createTestAccount(app);
        const { accessToken } = await signIn(account);
        await logout(accessToken).expect(204);

        const response = await logout(accessToken).expect(401);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'NOT_AUTHENTICATED',
        );
      });

      it('o refresh token também deixa de renovar, sem cascata nem alerta', async () => {
        const account = await createTestAccount(app);
        const { accessToken, refreshToken } = await signIn(account);
        await signIn(account);
        await logout(accessToken).expect(204);

        const response = await refresh(refreshToken).expect(401);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'SESSION_INVALID',
        );
        // Logout não é indício de roubo: o outro dispositivo segue conectado.
        await expect(activeSessionCount(account.id)).resolves.toBe(1);
        expect(mailProvider.sent).toHaveLength(0);
      });

      it('revoga o elo como LOGOUT', async () => {
        const account = await createTestAccount(app);
        const { accessToken, refreshToken } = await signIn(account);

        await logout(accessToken).expect(204);

        const session = await prisma.userSession.findUniqueOrThrow({
          where: { refresh_token_hash: opaqueTokens.hash(refreshToken) },
        });
        expect(session.revocation_reason).toBe(SessionRevocationReason.LOGOUT);
        expect(session.revoked_at).toBeInstanceOf(Date);
      });

      it('não afeta as sessões dos outros dispositivos', async () => {
        const account = await createTestAccount(app);
        const laptop = await signIn(account);
        const phone = await signIn(account);

        await logout(laptop.accessToken).expect(204);

        await logout(phone.accessToken).expect(204);
        await expect(activeSessionCount(account.id)).resolves.toBe(0);
      });

      it('encerra a família inteira: o token renovado também cai', async () => {
        const account = await createTestAccount(app);
        const login = await signIn(account);
        const renewed = await refresh(login.refreshToken).expect(200);

        await logout(renewed.body.access_token as string).expect(204);

        await refresh(renewed.body.refresh_token as string).expect(401);
      });

      it('não afeta as sessões de outro usuário', async () => {
        const account = await createTestAccount(app);
        const bystander = await createTestAccount(app);
        const mine = await signIn(account);
        await signIn(bystander);

        await logout(mine.accessToken).expect(204);

        await expect(activeSessionCount(bystander.id)).resolves.toBe(1);
      });
    });

    describe('todos os dispositivos', () => {
      it('204: derruba todas as sessões do usuário, inclusive a atual', async () => {
        const account = await createTestAccount(app);
        const laptop = await signIn(account);
        const phone = await signIn(account);

        await logoutAll(laptop.accessToken).expect(204);

        await expect(activeSessionCount(account.id)).resolves.toBe(0);
        await logout(phone.accessToken).expect(401);
        await refresh(phone.refreshToken).expect(401);
      });

      it('revoga como LOGOUT_ALL_DEVICES', async () => {
        const account = await createTestAccount(app);
        const laptop = await signIn(account);
        await signIn(account);

        await logoutAll(laptop.accessToken).expect(204);

        await expect(
          prisma.userSession.count({
            where: {
              revocation_reason: SessionRevocationReason.LOGOUT_ALL_DEVICES,
            },
          }),
        ).resolves.toBe(2);
      });

      it('não afeta as sessões de outro usuário', async () => {
        const account = await createTestAccount(app);
        const bystander = await createTestAccount(app);
        const mine = await signIn(account);
        await signIn(bystander);

        await logoutAll(mine.accessToken).expect(204);

        await expect(activeSessionCount(bystander.id)).resolves.toBe(1);
      });
    });

    describe('autenticação exigida', () => {
      it.each(['/auth/logout', '/auth/logout-all'])(
        '401 em %s sem token',
        async (path) => {
          await request(app.getHttpServer()).post(path).expect(401);
        },
      );

      it('o limite de requisições age antes da autenticação', async () => {
        // Se a autenticação rodasse primeiro, toda requisição com token falso
        // chegaria ao banco e nunca tomaria 429.
        const statuses: number[] = [];
        // O teto desta rota é o limite geral (por IP); o da API pública, por
        // chave, só incide nas rotas marcadas como tal.
        const limit = app
          .get<ConfigService<Environment, true>>(ConfigService)
          .get('THROTTLE_LIMIT', { infer: true });

        for (let attempt = 0; attempt < limit + 5; attempt += 1) {
          const response = await logout(faker.string.alphanumeric(120));
          statuses.push(response.status);
        }

        expect(statuses[0]).toBe(401);
        expect(statuses).toContain(429);
      });

      it('401 com token que não é do BIOS', async () => {
        await logout(faker.string.alphanumeric(120)).expect(401);
      });

      it('as rotas públicas seguem abertas sem token', async () => {
        await request(app.getHttpServer()).get('/health').expect(200);
        await request(app.getHttpServer())
          .post('/accounts/resend-confirmation')
          .send({ email: faker.internet.email() })
          .expect(202);
        await refresh(faker.string.alphanumeric(43)).expect(401);
      });
    });
  },
);
