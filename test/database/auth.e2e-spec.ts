import type { INestApplication } from '@nestjs/common';
import {
  AccessBlockReason,
  AccessBlockScope,
  LoginFailureReason,
  UserRole,
} from '@prisma/client';
import { AccessTokenProvider } from '@modules/authentication/domain/providers/access-token.provider.js';
import { MailProvider } from '@modules/mailing/domain/providers/mail.provider.js';
import { ErrorResponseSchema } from '@shared/domain/dtos/errors/error-response.dto.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { OpaqueTokenProvider } from '@shared/domain/providers/opaque-token.provider.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { Queue } from 'bullmq';
import request from 'supertest';
import { inject } from 'vitest';
import { buildPassword } from '../factories/shared/password.factory.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { faker } from '../support/faker.js';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';
import { testRedisUrl } from '../support/infrastructure.js';

const REDIS_URL = testRedisUrl();

/** Transporte dublê no lugar do SMTP: registra o que foi "enviado". */
class RecordingMailProvider extends MailProvider {
  readonly sent: { to: string; subject: string; text: string }[] = [];

  override send(message: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    this.sent.push({
      to: message.to,
      subject: message.subject,
      text: message.text,
    });

    return Promise.resolve();
  }
}

/**
 * Login contra banco, Redis e fila reais (UC02): sessão, registro de
 * tentativas e bloqueio por falhas consecutivas. Só o SMTP é substituído.
 * As contas são gravadas como a aplicação as grava, com os campos opcionais
 * ausentes.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Login (e2e)',
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

    const createAccount = (options?: { active?: boolean; role?: UserRole }) =>
      createTestAccount(app, options);

    function login(email: string, password: string) {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password });
    }

    /** Erra a senha `times` vezes seguidas, para a conta informada. */
    async function failLogin(email: string, times: number): Promise<void> {
      for (let attempt = 0; attempt < times; attempt += 1) {
        await login(email, buildPassword()).expect(401);
      }
    }

    /** Faz os bloqueios existentes terminarem, como se os 15 minutos tivessem passado. */
    async function expireBlocks(): Promise<void> {
      await prisma.accessBlock.updateMany({
        data: { blocked_until: new Date(Date.now() - 1_000) },
      });
    }

    describe('credenciais válidas', () => {
      it('200: abre a sessão e devolve o par de tokens', async () => {
        const account = await createAccount();

        const response = await login(account.email, account.password).expect(
          200,
        );

        expect(response.body).toMatchObject({
          token_type: 'Bearer',
          expires_in: 900,
          user: { id: account.id, role: UserRole.USER },
        });
        expect(response.body.access_token).toEqual(expect.any(String));
        expect(response.body.refresh_token).toEqual(expect.any(String));
      });

      it('o access token carrega a sessão gravada e é aceito pela verificação', async () => {
        const account = await createAccount({ role: UserRole.ADMIN });

        const { body } = await login(account.email, account.password).expect(
          200,
        );

        const session = await prisma.userSession.findFirstOrThrow();
        expect(accessTokens.verify(body.access_token as string)).toEqual({
          userId: account.id,
          sessionId: session.id_user_session,
          role: UserRole.ADMIN,
        });
      });

      it('grava a sessão só com o resumo do refresh token', async () => {
        const account = await createAccount();

        const { body } = await login(account.email, account.password)
          .set('User-Agent', 'Teste/1.0')
          .expect(200);

        const session = await prisma.userSession.findFirstOrThrow();
        expect(session.refresh_token_hash).toBe(
          opaqueTokens.hash(body.refresh_token as string),
        );
        expect(JSON.stringify(session)).not.toContain(body.refresh_token);
        expect(session).toMatchObject({
          user_id: account.id,
          user_agent: 'Teste/1.0',
          revoked_at: null,
        });
        expect(session.expires_at.getTime()).toBeGreaterThan(
          Date.now() + 6 * 24 * 3_600_000,
        );
      });

      it('cada login abre uma família de sessão própria', async () => {
        const account = await createAccount();

        await login(account.email, account.password).expect(200);
        await login(account.email, account.password).expect(200);

        const sessions = await prisma.userSession.findMany();
        expect(sessions).toHaveLength(2);
        expect(sessions[0].family_id).not.toBe(sessions[1].family_id);
      });

      it('registra a tentativa bem-sucedida e o último login', async () => {
        const account = await createAccount();

        await login(account.email, account.password).expect(200);

        const attempt = await prisma.loginAttempt.findFirstOrThrow();
        expect(attempt).toMatchObject({
          user_id: account.id,
          was_successful: true,
          failure_reason: null,
        });
        expect(attempt.ip).toEqual(expect.any(String));
        const user = await prisma.user.findUniqueOrThrow({
          where: { id_user: account.id },
        });
        expect(user.last_login_at).toBeInstanceOf(Date);
      });

      it('aceita o e-mail digitado com outra caixa', async () => {
        const account = await createAccount();

        await login(account.email.toUpperCase(), account.password).expect(200);
      });
    });

    describe('credenciais inválidas', () => {
      it('401: senha incorreta', async () => {
        const account = await createAccount();

        const response = await login(account.email, buildPassword()).expect(
          401,
        );

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'INVALID_CREDENTIALS',
        );
        await expect(prisma.userSession.count()).resolves.toBe(0);
      });

      it('responde o mesmo para e-mail sem conta e para senha incorreta', async () => {
        const account = await createAccount();

        const wrongPassword = await login(account.email, buildPassword());
        const unknownEmail = await login(
          faker.internet.email(),
          buildPassword(),
        );

        expect(unknownEmail.status).toBe(wrongPassword.status);
        const { code, message, statusCode } = ErrorResponseSchema.parse(
          wrongPassword.body,
        );
        expect(ErrorResponseSchema.parse(unknownEmail.body)).toMatchObject({
          code,
          message,
          statusCode,
        });
      });

      it('registra a falha, com a conta visada quando ela existe', async () => {
        const account = await createAccount();

        await login(account.email, buildPassword()).expect(401);
        await login(faker.internet.email(), buildPassword()).expect(401);

        const attempts = await prisma.loginAttempt.findMany({
          orderBy: { attempted_at: 'asc' },
        });
        expect(attempts).toHaveLength(2);
        expect(attempts[0]).toMatchObject({
          user_id: account.id,
          was_successful: false,
          failure_reason: LoginFailureReason.INVALID_CREDENTIALS,
        });
        expect(attempts[1].user_id).toBeNull();
      });

      it('422: e-mail malformado ou campo ausente', async () => {
        await login('nao-e-email', buildPassword()).expect(422);
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: faker.internet.email() })
          .expect(422);
      });
    });

    describe('conta não confirmada', () => {
      it('403: a senha certa avisa que falta confirmar o e-mail', async () => {
        const account = await createAccount({ active: false });

        const response = await login(account.email, account.password).expect(
          403,
        );

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'ACCOUNT_NOT_CONFIRMED',
        );
        await expect(prisma.userSession.count()).resolves.toBe(0);
        const attempt = await prisma.loginAttempt.findFirstOrThrow();
        expect(attempt.failure_reason).toBe(
          LoginFailureReason.ACCOUNT_INACTIVE,
        );
      });

      it('401: a senha errada não revela que a conta existe', async () => {
        const account = await createAccount({ active: false });

        await login(account.email, buildPassword()).expect(401);
      });

      it('repetir a tentativa não bloqueia a conta', async () => {
        const account = await createAccount({ active: false });

        for (let attempt = 0; attempt < 7; attempt += 1) {
          await login(account.email, account.password).expect(403);
        }

        await expect(prisma.accessBlock.count()).resolves.toBe(0);
      });
    });

    describe('bloqueio por tentativas', () => {
      it('a quinta falha ainda responde 401; a seguinte, 429', async () => {
        const account = await createAccount();

        await failLogin(account.email, 5);
        const response = await login(account.email, buildPassword()).expect(
          429,
        );

        expect(ErrorResponseSchema.parse(response.body)).toMatchObject({
          code: 'ACCESS_TEMPORARILY_BLOCKED',
          details: { retry_after_seconds: expect.any(Number) },
        });
        const { details } = ErrorResponseSchema.parse(response.body) as {
          details: { retry_after_seconds: number };
        };
        expect(details.retry_after_seconds).toBeGreaterThan(14 * 60);
        expect(details.retry_after_seconds).toBeLessThanOrEqual(15 * 60);
      });

      it('grava o bloqueio do IP e da conta por 15 minutos', async () => {
        const account = await createAccount();

        await failLogin(account.email, 5);

        const blocks = await prisma.accessBlock.findMany();
        expect(blocks.map(({ scope }) => scope).sort()).toEqual([
          AccessBlockScope.IP,
          AccessBlockScope.USER,
        ]);
        for (const block of blocks) {
          expect(block.reason).toBe(AccessBlockReason.LOGIN_ATTEMPTS);
          const remaining = block.blocked_until!.getTime() - Date.now();
          expect(remaining).toBeGreaterThan(14 * 60_000);
          expect(remaining).toBeLessThanOrEqual(15 * 60_000);
        }
        expect(
          blocks.find(({ scope }) => scope === AccessBlockScope.USER)?.user_id,
        ).toBe(account.id);
      });

      it('mesmo com a senha certa, quem está bloqueado não entra', async () => {
        const account = await createAccount();
        await failLogin(account.email, 5);

        await login(account.email, account.password).expect(429);

        await expect(prisma.userSession.count()).resolves.toBe(0);
      });

      it('registra a tentativa recusada pelo bloqueio', async () => {
        const account = await createAccount();
        await failLogin(account.email, 5);

        await login(account.email, buildPassword()).expect(429);

        await expect(
          prisma.loginAttempt.count({
            where: { failure_reason: LoginFailureReason.ACCESS_BLOCKED },
          }),
        ).resolves.toBe(1);
      });

      it('alerta o titular por e-mail', async () => {
        const account = await createAccount();

        await failLogin(account.email, 5);

        await vi.waitFor(
          () => {
            const alert = mailProvider.sent.find(
              ({ to }) => to === account.email,
            );

            expect(alert?.subject).toMatch(/suspeita/i);
          },
          { timeout: 10_000, interval: 100 },
        );
        expect(mailProvider.sent).toHaveLength(1);
      });

      it('quatro falhas não bloqueiam', async () => {
        const account = await createAccount();

        await failLogin(account.email, 4);

        await login(account.email, account.password).expect(200);
        await expect(prisma.accessBlock.count()).resolves.toBe(0);
      });

      it('um login correto zera a contagem', async () => {
        const account = await createAccount();
        await failLogin(account.email, 4);
        await login(account.email, account.password).expect(200);

        await failLogin(account.email, 4);

        await expect(prisma.accessBlock.count()).resolves.toBe(0);
      });

      it('depois que o bloqueio termina, o acesso volta', async () => {
        const account = await createAccount();
        await failLogin(account.email, 5);
        await expireBlocks();

        await login(account.email, account.password).expect(200);
      });

      it('depois que o bloqueio termina, a contagem recomeça do zero', async () => {
        const account = await createAccount();
        await failLogin(account.email, 5);
        await expireBlocks();

        // Uma falha logo após o bloqueio não pode reativá-lo com as cinco antigas.
        await login(account.email, buildPassword()).expect(401);
        await login(account.email, buildPassword()).expect(401);

        await expect(prisma.accessBlock.count()).resolves.toBe(2);
      });

      it('e-mail sem conta bloqueia o IP, sem alertar ninguém', async () => {
        const email = faker.internet.email();

        await failLogin(email, 5);
        await login(email, buildPassword()).expect(429);

        const blocks = await prisma.accessBlock.findMany();
        expect(blocks).toHaveLength(1);
        expect(blocks[0].scope).toBe(AccessBlockScope.IP);
        expect(mailProvider.sent).toHaveLength(0);
      });

      it('o bloqueio do IP vale também para outras contas', async () => {
        const target = await createAccount();
        const other = await createAccount();
        await failLogin(target.email, 5);

        await login(other.email, other.password).expect(429);
      });

      it('bloqueio sem prazo, gravado sem blocked_until, também recusa', async () => {
        const account = await createAccount();
        // Como o honeypot grava: sem prazo.
        await prisma.accessBlock.create({
          data: {
            scope: AccessBlockScope.USER,
            user_id: account.id,
            reason: AccessBlockReason.HONEYPOT,
          },
        });

        const response = await login(account.email, account.password).expect(
          429,
        );

        expect(
          ErrorResponseSchema.parse(response.body).details,
        ).toBeUndefined();
      });
    });
  },
);
