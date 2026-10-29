import type { INestApplication } from '@nestjs/common';
import {
  BlockedDomainOrigin,
  UserRole,
  UserTokenPurpose,
} from '@prisma/client';
import { MailProvider } from '@modules/mailing/domain/providers/mail.provider.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { ErrorResponseSchema } from '@shared/domain/dtos/errors/error-response.dto.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { Queue } from 'bullmq';
import request from 'supertest';
import { inject } from 'vitest';
import { buildPassword } from '../factories/shared/password.factory.js';
import { faker } from '../support/faker.js';
import {
  createDatabaseTestingApp,
  waitForEmailQueue,
} from '../support/database-testing-app.js';
import { resetThrottleCounters } from '../support/throttle.js';
import { testRedisUrl } from '../support/infrastructure.js';

const REDIS_URL = testRedisUrl();

/** Transporte dublê no lugar do SMTP: registra o que foi "enviado". */
class RecordingMailProvider extends MailProvider {
  readonly sent: { to: string; subject: string; html: string; text: string }[] =
    [];

  override send(message: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    this.sent.push({ ...message });

    return Promise.resolve();
  }
}

/**
 * Cadastro e confirmação de conta contra banco, Redis e fila reais (UC01).
 * Só o SMTP é substituído; o link do e-mail é lido da mensagem enviada, como
 * o usuário o leria.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Cadastro e confirmação de conta (e2e)',
  () => {
    const mailProvider = new RecordingMailProvider();
    let app: INestApplication;
    let prisma: PrismaService;

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp((builder) => {
        builder.overrideProvider(MailProvider).useValue(mailProvider);
      }));
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
        'user_tokens',
        'email_dispatch_logs',
        'blocked_email_domains',
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

    function buildBody(overrides: Record<string, unknown> = {}) {
      return {
        name: faker.person.fullName(),
        email: faker.internet.email().toLowerCase(),
        password: buildPassword(),
        ...overrides,
      };
    }

    function register(body: Record<string, unknown>) {
      return request(app.getHttpServer()).post('/accounts').send(body);
    }

    /** Aguarda a entrega do e-mail e devolve o token do link recebido. */
    async function tokenFromEmailTo(email: string): Promise<string> {
      let token = '';

      await vi.waitFor(
        () => {
          const message = mailProvider.sent.findLast(({ to }) => to === email);
          const match = /confirmar-email\/([A-Za-z0-9_-]+)/.exec(
            message?.text ?? '',
          );

          expect(match).not.toBeNull();
          token = match![1];
        },
        { timeout: 10_000, interval: 100 },
      );

      return token;
    }

    describe('POST /accounts', () => {
      it('202: cria conta inativa, com dados protegidos, e envia o link', async () => {
        const body = buildBody();

        const response = await register(body).expect(202);

        expect(response.body).toEqual({ message: expect.any(String) });
        const user = await prisma.user.findFirstOrThrow();
        expect(user).toMatchObject({
          user_name: body.name,
          role: UserRole.USER,
          is_active: false,
        });
        // Nada pessoal é gravado em claro.
        expect(user.email_encrypted).not.toContain(body.email);
        expect(user.password_encrypted).not.toContain(body.password);
        await expect(tokenFromEmailTo(body.email)).resolves.toMatch(
          /^[A-Za-z0-9_-]{43}$/,
        );
      });

      it('grava só o resumo do token de confirmação', async () => {
        const body = buildBody();
        await register(body).expect(202);
        const token = await tokenFromEmailTo(body.email);

        const stored = await prisma.userToken.findFirstOrThrow();

        expect(stored.purpose).toBe(UserTokenPurpose.EMAIL_CONFIRMATION);
        expect(JSON.stringify(stored)).not.toContain(token);
      });

      it('trata e-mails que só diferem na caixa como a mesma conta', async () => {
        const body = buildBody();
        await register(body).expect(202);

        await register({
          ...body,
          email: body.email.toUpperCase(),
        }).expect(202);

        await expect(prisma.user.count()).resolves.toBe(1);
      });

      it('202 igual para e-mail já cadastrado, sem nova conta nem novo e-mail', async () => {
        const body = buildBody();
        const first = await register(body).expect(202);
        await tokenFromEmailTo(body.email);

        const second = await register({
          ...body,
          name: faker.person.fullName(),
        }).expect(202);

        expect(second.body).toEqual(first.body);
        await expect(prisma.user.count()).resolves.toBe(1);
        await expect(prisma.emailDispatchLog.count()).resolves.toBe(1);
      });

      it('cria uma só conta quando o mesmo e-mail chega em requisições simultâneas', async () => {
        const body = buildBody();

        const responses = await Promise.all(
          Array.from({ length: 5 }, () => register(body)),
        );

        expect(responses.map(({ status }) => status)).toEqual(
          Array(5).fill(202),
        );
        await expect(prisma.user.count()).resolves.toBe(1);
      });

      it('422: recusa domínio da blacklist semeado, sem criar conta', async () => {
        const domain = faker.internet.domainName();
        // Como o seeder grava: sem o campo de remoção lógica.
        await prisma.blockedEmailDomain.create({
          data: { domain, origin: BlockedDomainOrigin.SEED },
        });

        const response = await register(
          buildBody({ email: `${faker.internet.username()}@${domain}` }),
        ).expect(422);

        expect(ErrorResponseSchema.parse(response.body)).toMatchObject({
          code: 'EMAIL_DOMAIN_NOT_ALLOWED',
        });
        await expect(prisma.user.count()).resolves.toBe(0);
      });

      it('422: informa os campos inválidos', async () => {
        const response = await register({
          name: 'A',
          email: 'nao-e-email',
          password: 'curta',
        }).expect(422);

        const { details } = ErrorResponseSchema.parse(response.body);
        expect(details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: 'name' }),
            expect.objectContaining({ path: 'email' }),
            expect.objectContaining({ path: 'password' }),
          ]),
        );
        await expect(prisma.user.count()).resolves.toBe(0);
      });
    });

    describe('POST /accounts/confirm-email', () => {
      it('200: ativa a conta com o token do link', async () => {
        const body = buildBody();
        await register(body).expect(202);
        const token = await tokenFromEmailTo(body.email);

        await request(app.getHttpServer())
          .post('/accounts/confirm-email')
          .send({ token })
          .expect(200);

        const user = await prisma.user.findFirstOrThrow();
        expect(user.is_active).toBe(true);
        expect(user.email_confirmed_at).toBeInstanceOf(Date);
      });

      it('400: o link só vale uma vez', async () => {
        const body = buildBody();
        await register(body).expect(202);
        const token = await tokenFromEmailTo(body.email);
        await request(app.getHttpServer())
          .post('/accounts/confirm-email')
          .send({ token })
          .expect(200);

        const response = await request(app.getHttpServer())
          .post('/accounts/confirm-email')
          .send({ token })
          .expect(400);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'USER_TOKEN_INVALID',
        );
      });

      it('400: token que nunca foi emitido', async () => {
        await request(app.getHttpServer())
          .post('/accounts/confirm-email')
          .send({ token: faker.string.alphanumeric(43) })
          .expect(400);
      });

      it('400: link expirado, e a conta segue inativa', async () => {
        const body = buildBody();
        await register(body).expect(202);
        const token = await tokenFromEmailTo(body.email);
        await prisma.userToken.updateMany({
          data: { expires_at: faker.date.recent() },
        });

        await request(app.getHttpServer())
          .post('/accounts/confirm-email')
          .send({ token })
          .expect(400);

        const user = await prisma.user.findFirstOrThrow();
        expect(user.is_active).toBe(false);
      });

      it('422: exige o token', async () => {
        await request(app.getHttpServer())
          .post('/accounts/confirm-email')
          .send({})
          .expect(422);
      });
    });

    describe('POST /accounts/resend-confirmation', () => {
      it('202: envia novo link e invalida o anterior', async () => {
        const body = buildBody();
        await register(body).expect(202);
        const firstToken = await tokenFromEmailTo(body.email);

        await request(app.getHttpServer())
          .post('/accounts/resend-confirmation')
          .send({ email: body.email })
          .expect(202);
        await vi.waitFor(() => expect(mailProvider.sent).toHaveLength(2), {
          timeout: 10_000,
          interval: 100,
        });
        const secondToken = await tokenFromEmailTo(body.email);

        expect(secondToken).not.toBe(firstToken);
        await request(app.getHttpServer())
          .post('/accounts/confirm-email')
          .send({ token: firstToken })
          .expect(400);
        await request(app.getHttpServer())
          .post('/accounts/confirm-email')
          .send({ token: secondToken })
          .expect(200);
      });

      it('202 igual, sem enviar nada, para e-mail sem conta', async () => {
        const response = await request(app.getHttpServer())
          .post('/accounts/resend-confirmation')
          .send({ email: faker.internet.email() })
          .expect(202);

        expect(response.body).toEqual({ message: expect.any(String) });
        await expect(prisma.emailDispatchLog.count()).resolves.toBe(0);
      });

      it('202 igual, sem enviar nada, para conta já ativa', async () => {
        const body = buildBody();
        await register(body).expect(202);
        const token = await tokenFromEmailTo(body.email);
        await request(app.getHttpServer())
          .post('/accounts/confirm-email')
          .send({ token })
          .expect(200);
        const dispatched = await prisma.emailDispatchLog.count();

        await request(app.getHttpServer())
          .post('/accounts/resend-confirmation')
          .send({ email: body.email })
          .expect(202);

        await expect(prisma.emailDispatchLog.count()).resolves.toBe(dispatched);
      });
    });
  },
);
