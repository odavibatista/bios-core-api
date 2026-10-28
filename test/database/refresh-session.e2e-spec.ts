import type { INestApplication } from '@nestjs/common';
import { SessionRevocationReason, UserRole } from '@prisma/client';
import { AccessTokenProvider } from '@modules/authentication/domain/providers/access-token.provider.js';
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
  readonly sent: { to: string; subject: string }[] = [];

  override send(message: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    this.sent.push({ to: message.to, subject: message.subject });

    return Promise.resolve();
  }
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Renovação de sessão contra banco, Redis e fila reais (UC17): rotação do
 * refresh token, detecção de reuso e a disputa entre pedidos simultâneos com o
 * mesmo token. Só o SMTP é substituído; as sessões são abertas pelo login real.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Renovação de sessão (e2e)',
  () => {
    const mailProvider = new RecordingMailProvider();
    let app: INestApplication;
    let prisma: PrismaService;
    let accessTokens: AccessTokenProvider;
    let opaqueTokens: OpaqueTokenProvider;

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp((builder) => {
        builder.overrideProvider(MailProvider).useValue(mailProvider);
      }));
      accessTokens = app.get(AccessTokenProvider);
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

    /** Abre uma sessão pelo login, como o front-end faria. */
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

    function refresh(refreshToken: string) {
      return request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken });
    }

    async function activeSessionCount(userId: string): Promise<number> {
      return prisma.userSession.count({
        where: {
          user_id: userId,
          OR: [{ revoked_at: null }, { revoked_at: { isSet: false } }],
        },
      });
    }

    describe('refresh token ativo', () => {
      it('200: devolve um novo par de tokens no formato do login', async () => {
        const account = await createTestAccount(app);
        const { refreshToken } = await signIn(account);

        const response = await refresh(refreshToken).expect(200);

        expect(response.body).toMatchObject({
          token_type: 'Bearer',
          expires_in: 900,
          user: { id: account.id, role: UserRole.USER },
        });
        expect(response.body.refresh_token).not.toBe(refreshToken);
      });

      it('revoga o elo antigo como ROTATED e aponta para o novo, na mesma família', async () => {
        const account = await createTestAccount(app);
        const { refreshToken } = await signIn(account);

        const { body } = await refresh(refreshToken).expect(200);

        const previous = await prisma.userSession.findUniqueOrThrow({
          where: { refresh_token_hash: opaqueTokens.hash(refreshToken) },
        });
        const next = await prisma.userSession.findUniqueOrThrow({
          where: {
            refresh_token_hash: opaqueTokens.hash(body.refresh_token as string),
          },
        });
        expect(previous).toMatchObject({
          revocation_reason: SessionRevocationReason.ROTATED,
          replaced_by_session_id: next.id_user_session,
        });
        expect(previous.revoked_at).toBeInstanceOf(Date);
        expect(next.family_id).toBe(previous.family_id);
        expect(next.revoked_at).toBeNull();
      });

      it('o novo access token carrega o novo elo da sessão', async () => {
        const account = await createTestAccount(app);
        const { refreshToken } = await signIn(account);

        const { body } = await refresh(refreshToken).expect(200);

        const next = await prisma.userSession.findUniqueOrThrow({
          where: {
            refresh_token_hash: opaqueTokens.hash(body.refresh_token as string),
          },
        });
        expect(accessTokens.verify(body.access_token as string)).toEqual({
          userId: account.id,
          sessionId: next.id_user_session,
          role: UserRole.USER,
        });
      });

      it('o novo access token traz o papel vigente, não o do login', async () => {
        const account = await createTestAccount(app);
        const { refreshToken } = await signIn(account);
        await prisma.user.update({
          where: { id_user: account.id },
          data: { role: UserRole.ADMIN },
        });

        const { body } = await refresh(refreshToken).expect(200);

        expect(accessTokens.verify(body.access_token as string)?.role).toBe(
          UserRole.ADMIN,
        );
        expect(body.user.role).toBe(UserRole.ADMIN);
      });

      it('grava só o resumo do novo refresh token e renova a expiração', async () => {
        const account = await createTestAccount(app);
        const { refreshToken } = await signIn(account);

        const { body } = await refresh(refreshToken)
          .set('User-Agent', 'Renovacao/2.0')
          .expect(200);

        const next = await prisma.userSession.findUniqueOrThrow({
          where: {
            refresh_token_hash: opaqueTokens.hash(body.refresh_token as string),
          },
        });
        expect(JSON.stringify(next)).not.toContain(body.refresh_token);
        expect(next.user_agent).toBe('Renovacao/2.0');
        expect(next.expires_at.getTime()).toBeGreaterThan(
          Date.now() + 6 * 24 * 3_600_000,
        );
      });

      it('a cadeia segue: cada token novo renova o seguinte', async () => {
        const account = await createTestAccount(app);
        let { refreshToken } = await signIn(account);

        for (let renewal = 0; renewal < 3; renewal += 1) {
          const { body } = await refresh(refreshToken).expect(200);
          refreshToken = body.refresh_token as string;
        }

        await expect(
          prisma.userSession.count({
            where: { revocation_reason: SessionRevocationReason.ROTATED },
          }),
        ).resolves.toBe(3);
        await expect(activeSessionCount(account.id)).resolves.toBe(1);
      });

      it('renovar uma sessão não mexe nas sessões de outros dispositivos', async () => {
        const account = await createTestAccount(app);
        const laptop = await signIn(account);
        await signIn(account);

        await refresh(laptop.refreshToken).expect(200);

        await expect(activeSessionCount(account.id)).resolves.toBe(2);
      });
    });

    describe('reuso de refresh token já rotacionado', () => {
      it('401 com a resposta genérica', async () => {
        const account = await createTestAccount(app);
        const { refreshToken } = await signIn(account);
        await refresh(refreshToken).expect(200);

        const response = await refresh(refreshToken).expect(401);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'SESSION_INVALID',
        );
      });

      it('derruba todas as sessões do usuário, inclusive o token novo e outros dispositivos', async () => {
        const account = await createTestAccount(app);
        const stolen = await signIn(account);
        await signIn(account);
        const renewed = await refresh(stolen.refreshToken).expect(200);

        await refresh(stolen.refreshToken).expect(401);

        await expect(activeSessionCount(account.id)).resolves.toBe(0);
        await refresh(renewed.body.refresh_token as string).expect(401);
        await expect(
          prisma.userSession.count({
            where: {
              revocation_reason: SessionRevocationReason.REUSE_DETECTED,
            },
          }),
        ).resolves.toBe(2);
      });

      it('avisa o titular por e-mail, no endereço da conta', async () => {
        const account = await createTestAccount(app);
        const { refreshToken } = await signIn(account);
        await refresh(refreshToken).expect(200);

        await refresh(refreshToken).expect(401);

        await vi.waitFor(
          () => {
            expect(
              mailProvider.sent.find(({ to }) => to === account.email)?.subject,
            ).toMatch(/suspeita/i);
          },
          { timeout: 10_000, interval: 100 },
        );
        expect(mailProvider.sent).toHaveLength(1);
      });

      it('não afeta as sessões de outro usuário', async () => {
        const victim = await createTestAccount(app);
        const bystander = await createTestAccount(app);
        const stolen = await signIn(victim);
        await signIn(bystander);
        await refresh(stolen.refreshToken).expect(200);

        await refresh(stolen.refreshToken).expect(401);

        await expect(activeSessionCount(bystander.id)).resolves.toBe(1);
      });
    });

    describe('recusas sem indício de roubo', () => {
      it('401 para refresh token que nunca foi emitido, sem revogar nada', async () => {
        const account = await createTestAccount(app);
        await signIn(account);

        await refresh(faker.string.alphanumeric(43)).expect(401);

        await expect(activeSessionCount(account.id)).resolves.toBe(1);
        expect(mailProvider.sent).toHaveLength(0);
      });

      it('401 para refresh token expirado, sem derrubar as outras sessões', async () => {
        const account = await createTestAccount(app);
        const expired = await signIn(account);
        await signIn(account);
        await prisma.userSession.updateMany({
          where: {
            refresh_token_hash: opaqueTokens.hash(expired.refreshToken),
          },
          data: { expires_at: faker.date.recent() },
        });

        await refresh(expired.refreshToken).expect(401);

        await expect(activeSessionCount(account.id)).resolves.toBe(2);
        expect(mailProvider.sent).toHaveLength(0);
      });

      it('401 para elo revogado por logout, sem cascata', async () => {
        const account = await createTestAccount(app);
        const loggedOut = await signIn(account);
        await signIn(account);
        await prisma.userSession.updateMany({
          where: {
            refresh_token_hash: opaqueTokens.hash(loggedOut.refreshToken),
          },
          data: {
            revoked_at: new Date(),
            revocation_reason: SessionRevocationReason.LOGOUT,
          },
        });

        await refresh(loggedOut.refreshToken).expect(401);

        await expect(activeSessionCount(account.id)).resolves.toBe(1);
        expect(mailProvider.sent).toHaveLength(0);
      });

      it('todas as recusas respondem exatamente o mesmo erro', async () => {
        const account = await createTestAccount(app);
        const reused = await signIn(account);
        await refresh(reused.refreshToken).expect(200);

        const unknown = await refresh(faker.string.alphanumeric(43));
        const reuse = await refresh(reused.refreshToken);

        const { code, message, statusCode } = ErrorResponseSchema.parse(
          unknown.body,
        );
        expect(ErrorResponseSchema.parse(reuse.body)).toMatchObject({
          code,
          message,
          statusCode,
        });
      });

      it('401 e nenhuma troca para conta ainda não confirmada', async () => {
        const account = await createTestAccount(app);
        const { refreshToken } = await signIn(account);
        await prisma.user.update({
          where: { id_user: account.id },
          data: { is_active: false },
        });

        await refresh(refreshToken).expect(401);

        await expect(prisma.userSession.count()).resolves.toBe(1);
      });
    });

    describe('renovações simultâneas com o mesmo token', () => {
      it('no máximo uma passa; as demais recebem 401, nunca erro interno', async () => {
        const account = await createTestAccount(app);
        const { refreshToken } = await signIn(account);

        const responses = await Promise.all(
          Array.from({ length: 10 }, () => refresh(refreshToken)),
        );

        const statuses = responses.map(({ status }) => status);
        expect(
          statuses.filter((status) => status === 200).length,
        ).toBeLessThanOrEqual(1);
        expect(
          statuses.every((status) => status === 200 || status === 401),
        ).toBe(true);
        // Cada token tem um único sucessor: nunca duas sessões derivam do mesmo elo.
        await expect(
          prisma.userSession.count({
            where: { revocation_reason: SessionRevocationReason.ROTATED },
          }),
        ).resolves.toBeLessThanOrEqual(1);
      });

      it('a disputa perdida é tratada como reuso: avisa o titular', async () => {
        const account = await createTestAccount(app);
        const { refreshToken } = await signIn(account);

        await Promise.all(
          Array.from({ length: 10 }, () => refresh(refreshToken)),
        );

        await vi.waitFor(
          () => {
            expect(
              mailProvider.sent.some(({ to }) => to === account.email),
            ).toBe(true);
          },
          { timeout: 10_000, interval: 100 },
        );
      });
    });

    describe('validação', () => {
      it('422: exige o refresh token', async () => {
        await request(app.getHttpServer())
          .post('/auth/refresh')
          .send({})
          .expect(422);
      });

      it('422: recusa refresh token vazio', async () => {
        await refresh('').expect(422);
      });
    });
  },
);
