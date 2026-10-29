import type { INestApplication } from '@nestjs/common';
import { SessionRevocationReason, UserTokenPurpose } from '@prisma/client';
import { MailProvider } from '@modules/mailing/domain/providers/mail.provider.js';
import { ErrorResponseSchema } from '@shared/domain/dtos/errors/error-response.dto.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { Queue } from 'bullmq';
import request from 'supertest';
import { inject } from 'vitest';
import { buildPassword } from '../factories/shared/password.factory.js';
import {
  createDatabaseTestingApp,
  waitForEmailQueue,
} from '../support/database-testing-app.js';
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

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Troca e recuperação de senha contra banco, Redis e fila reais (UC04): a
 * senha nova vale, a antiga não, e todas as sessões caem. As sessões são
 * abertas pelo login real e o link de recuperação é lido do e-mail enviado.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Troca e recuperação de senha (e2e)',
  () => {
    const mailProvider = new RecordingMailProvider();
    let app: INestApplication;
    let prisma: PrismaService;
    let encryption: EncryptionProvider;

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp((builder) => {
        builder.overrideProvider(MailProvider).useValue(mailProvider);
      }));
      encryption = app.get(EncryptionProvider);
    });

    beforeEach(async () => {
      await resetThrottleCounters(REDIS_URL);
    });

    afterEach(async () => {
      // Um e-mail ainda na fila chegaria ao dublê durante o teste seguinte.
      await waitForEmailQueue(app);
      mailProvider.sent.length = 0;
      await prisma.reset([
        'users',
        'user_sessions',
        'user_tokens',
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

    const login = (email: string, password: string) =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password });

    async function signIn(account: TestAccount): Promise<Tokens> {
      const { body } = await login(account.email, account.password).expect(200);

      return {
        accessToken: body.access_token as string,
        refreshToken: body.refresh_token as string,
      };
    }

    const changePassword = (
      accessToken: string | undefined,
      body: Record<string, unknown>,
    ) => {
      const call = request(app.getHttpServer())
        .post('/auth/change-password')
        .send(body);

      return accessToken
        ? call.set('Authorization', `Bearer ${accessToken}`)
        : call;
    };

    const forgotPassword = (email: string) =>
      request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email });

    const resetPassword = (token: string, newPassword: string) =>
      request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, new_password: newPassword });

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

    /** Aguarda o e-mail de recuperação e devolve o token do link recebido. */
    async function resetTokenSentTo(email: string): Promise<string> {
      let token = '';

      await vi.waitFor(
        () => {
          const message = mailProvider.sent.findLast(({ to }) => to === email);
          const match = /redefinir-senha\/([A-Za-z0-9_-]+)/.exec(
            message?.text ?? '',
          );

          expect(match).not.toBeNull();
          token = match![1];
        },
        { timeout: 10_000, interval: 100 },
      );

      return token;
    }

    describe('troca pelo usuário autenticado', () => {
      it('204: a senha nova passa a valer e a antiga deixa de valer', async () => {
        const account = await createTestAccount(app);
        const { accessToken } = await signIn(account);
        const newPassword = buildPassword();

        await changePassword(accessToken, {
          current_password: account.password,
          new_password: newPassword,
        }).expect(204);

        await login(account.email, newPassword).expect(200);
        await login(account.email, account.password).expect(401);
      });

      it('derruba todas as sessões, inclusive a que fez o pedido e as de outros dispositivos', async () => {
        const account = await createTestAccount(app);
        const laptop = await signIn(account);
        const phone = await signIn(account);

        await changePassword(laptop.accessToken, {
          current_password: account.password,
          new_password: buildPassword(),
        }).expect(204);

        await expect(activeSessionCount(account.id)).resolves.toBe(0);
        await changePassword(laptop.accessToken, {}).expect(401);
        await changePassword(phone.accessToken, {}).expect(401);
        await refresh(phone.refreshToken).expect(401);
        await expect(
          prisma.userSession.count({
            where: {
              revocation_reason: SessionRevocationReason.PASSWORD_CHANGE,
            },
          }),
        ).resolves.toBe(2);
      });

      it('registra a data da troca e mantém o e-mail legível', async () => {
        const account = await createTestAccount(app);
        const { accessToken } = await signIn(account);

        await changePassword(accessToken, {
          current_password: account.password,
          new_password: buildPassword(),
        }).expect(204);

        const user = await prisma.user.findUniqueOrThrow({
          where: { id_user: account.id },
        });
        expect(user.password_changed_at).toBeInstanceOf(Date);
        expect(
          encryption.decrypt({
            ciphertext: user.email_encrypted,
            keyVersion: user.encryption_key_version,
          }),
        ).toBe(account.email);
      });

      it('422: senha atual incorreta, sem derrubar as sessões', async () => {
        const account = await createTestAccount(app);
        const { accessToken } = await signIn(account);

        const response = await changePassword(accessToken, {
          current_password: buildPassword(),
          new_password: buildPassword(),
        }).expect(422);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'INVALID_CURRENT_PASSWORD',
        );
        await expect(activeSessionCount(account.id)).resolves.toBe(1);
        await login(account.email, account.password).expect(200);
      });

      it('422: nova senha igual à atual, sem derrubar as sessões', async () => {
        const account = await createTestAccount(app);
        const { accessToken } = await signIn(account);

        const response = await changePassword(accessToken, {
          current_password: account.password,
          new_password: account.password,
        }).expect(422);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'PASSWORD_UNCHANGED',
        );
        await expect(activeSessionCount(account.id)).resolves.toBe(1);
      });

      it('422: nova senha fora da política, informando o campo', async () => {
        const account = await createTestAccount(app);
        const { accessToken } = await signIn(account);

        const response = await changePassword(accessToken, {
          current_password: account.password,
          new_password: 'curta',
        }).expect(422);

        expect(ErrorResponseSchema.parse(response.body).details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: 'new_password' }),
          ]),
        );
        await expect(activeSessionCount(account.id)).resolves.toBe(1);
      });

      it('401 sem sessão', async () => {
        await changePassword(undefined, {
          current_password: buildPassword(),
          new_password: buildPassword(),
        }).expect(401);
      });

      it('não afeta as sessões de outro usuário', async () => {
        const account = await createTestAccount(app);
        const bystander = await createTestAccount(app);
        const mine = await signIn(account);
        await signIn(bystander);

        await changePassword(mine.accessToken, {
          current_password: account.password,
          new_password: buildPassword(),
        }).expect(204);

        await expect(activeSessionCount(bystander.id)).resolves.toBe(1);
      });
    });

    describe('pedido de recuperação', () => {
      it('202: envia o link de recuperação à conta ativa', async () => {
        const account = await createTestAccount(app);

        const response = await forgotPassword(account.email).expect(202);

        expect(response.body).toEqual({ message: expect.any(String) });
        await expect(resetTokenSentTo(account.email)).resolves.toMatch(
          /^[A-Za-z0-9_-]{43}$/,
        );
        expect(mailProvider.sent[0].subject).toMatch(/senha/i);
      });

      it('grava só o resumo do token, com a validade curta de recuperação', async () => {
        const account = await createTestAccount(app);
        await forgotPassword(account.email).expect(202);
        const token = await resetTokenSentTo(account.email);

        const stored = await prisma.userToken.findFirstOrThrow();

        expect(stored.purpose).toBe(UserTokenPurpose.PASSWORD_RESET);
        expect(JSON.stringify(stored)).not.toContain(token);
        const remaining = stored.expires_at.getTime() - Date.now();
        expect(remaining).toBeGreaterThan(110 * 60_000);
        expect(remaining).toBeLessThanOrEqual(120 * 60_000);
      });

      it('responde igual para e-mail sem conta e para conta não confirmada, sem enviar nada', async () => {
        const inactive = await createTestAccount(app, { active: false });
        const active = await createTestAccount(app);

        const known = await forgotPassword(active.email).expect(202);
        const unknown = await forgotPassword(faker.internet.email()).expect(
          202,
        );
        const unconfirmed = await forgotPassword(inactive.email).expect(202);

        expect(unknown.body).toEqual(known.body);
        expect(unconfirmed.body).toEqual(known.body);
        await expect(resetTokenSentTo(active.email)).resolves.toBeDefined();
        await expect(prisma.emailDispatchLog.count()).resolves.toBe(1);
      });

      it('pedir outro link invalida o anterior', async () => {
        const account = await createTestAccount(app);
        await forgotPassword(account.email).expect(202);
        const first = await resetTokenSentTo(account.email);
        await forgotPassword(account.email).expect(202);
        await vi.waitFor(() => expect(mailProvider.sent).toHaveLength(2), {
          timeout: 10_000,
          interval: 100,
        });
        const second = await resetTokenSentTo(account.email);

        await resetPassword(first, buildPassword()).expect(400);
        await resetPassword(second, buildPassword()).expect(204);
      });

      it('422: e-mail malformado', async () => {
        await forgotPassword('nao-e-email').expect(422);
      });
    });

    describe('redefinição pelo link', () => {
      it('204: a senha nova passa a valer e a antiga deixa de valer', async () => {
        const account = await createTestAccount(app);
        await forgotPassword(account.email).expect(202);
        const token = await resetTokenSentTo(account.email);
        const newPassword = buildPassword();

        await resetPassword(token, newPassword).expect(204);

        await login(account.email, newPassword).expect(200);
        await login(account.email, account.password).expect(401);
      });

      it('derruba todas as sessões da conta como PASSWORD_RESET', async () => {
        const account = await createTestAccount(app);
        const laptop = await signIn(account);
        await signIn(account);
        await forgotPassword(account.email).expect(202);
        const token = await resetTokenSentTo(account.email);

        await resetPassword(token, buildPassword()).expect(204);

        await expect(activeSessionCount(account.id)).resolves.toBe(0);
        await refresh(laptop.refreshToken).expect(401);
        await expect(
          prisma.userSession.count({
            where: {
              revocation_reason: SessionRevocationReason.PASSWORD_RESET,
            },
          }),
        ).resolves.toBe(2);
      });

      it('o link só vale uma vez', async () => {
        const account = await createTestAccount(app);
        await forgotPassword(account.email).expect(202);
        const token = await resetTokenSentTo(account.email);
        await resetPassword(token, buildPassword()).expect(204);

        const response = await resetPassword(token, buildPassword()).expect(
          400,
        );

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'USER_TOKEN_INVALID',
        );
      });

      it('uma senha fora da política não gasta o link', async () => {
        const account = await createTestAccount(app);
        await forgotPassword(account.email).expect(202);
        const token = await resetTokenSentTo(account.email);

        await resetPassword(token, 'curta').expect(422);

        await resetPassword(token, buildPassword()).expect(204);
      });

      it('400: token que nunca foi emitido', async () => {
        await resetPassword(
          faker.string.alphanumeric(43),
          buildPassword(),
        ).expect(400);
      });

      it('400: link expirado, e a senha segue a mesma', async () => {
        const account = await createTestAccount(app);
        await forgotPassword(account.email).expect(202);
        const token = await resetTokenSentTo(account.email);
        await prisma.userToken.updateMany({
          data: { expires_at: faker.date.recent() },
        });

        await resetPassword(token, buildPassword()).expect(400);

        await login(account.email, account.password).expect(200);
      });

      it('400: link de outra finalidade não redefine senha', async () => {
        const account = await createTestAccount(app);
        await forgotPassword(account.email).expect(202);
        const token = await resetTokenSentTo(account.email);
        await prisma.userToken.updateMany({
          data: { purpose: UserTokenPurpose.EMAIL_CONFIRMATION },
        });

        await resetPassword(token, buildPassword()).expect(400);
      });

      it('não afeta as sessões de outro usuário', async () => {
        const account = await createTestAccount(app);
        const bystander = await createTestAccount(app);
        await signIn(bystander);
        await forgotPassword(account.email).expect(202);
        const token = await resetTokenSentTo(account.email);

        await resetPassword(token, buildPassword()).expect(204);

        await expect(activeSessionCount(bystander.id)).resolves.toBe(1);
      });

      it('mantém o e-mail legível depois da redefinição', async () => {
        const account = await createTestAccount(app);
        await forgotPassword(account.email).expect(202);
        const token = await resetTokenSentTo(account.email);

        await resetPassword(token, buildPassword()).expect(204);

        const user = await prisma.user.findUniqueOrThrow({
          where: { id_user: account.id },
        });
        expect(
          encryption.decrypt({
            ciphertext: user.email_encrypted,
            keyVersion: user.encryption_key_version,
          }),
        ).toBe(account.email);
      });

      it('as rotas de recuperação são públicas: funcionam sem sessão', async () => {
        await forgotPassword(faker.internet.email()).expect(202);
        await resetPassword(
          faker.string.alphanumeric(43),
          buildPassword(),
        ).expect(400);
      });
    });
  },
);
