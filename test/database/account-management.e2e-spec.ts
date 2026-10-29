import type { INestApplication } from '@nestjs/common';
import {
  AccessBlockReason,
  AccessBlockScope,
  BlockedDomainOrigin,
  EmailTemplate,
  LoginFailureReason,
  UserRole,
  UserTokenPurpose,
} from '@prisma/client';
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

function buildAddress(overrides: Record<string, unknown> = {}) {
  return {
    postal_code: '01310-100',
    street: 'Avenida Paulista',
    number: '1578',
    complement: 'Conjunto 12',
    neighborhood: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
    ...overrides,
  };
}

/**
 * Manutenção da própria conta contra banco, Redis e fila reais (UC05): leitura,
 * edição, troca de e-mail com confirmação no novo endereço e exclusão com
 * eliminação dos dados. As sessões são abertas pelo login real.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Manutenção da conta (e2e)',
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
        'api_keys',
        'blocked_email_domains',
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

    /** Abre uma sessão pelo login real e devolve o access token. */
    async function signIn(account: TestAccount): Promise<string> {
      const { body } = await login(account.email, account.password).expect(200);

      return body.access_token as string;
    }

    function authed(
      method: 'get' | 'patch' | 'post' | 'delete',
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

    /** Aguarda o e-mail ao endereço e devolve o token do link recebido. */
    async function tokenSentTo(email: string, route: string): Promise<string> {
      let token = '';

      await vi.waitFor(
        () => {
          const message = mailProvider.sent.findLast(({ to }) => to === email);
          const match = new RegExp(`${route}/([A-Za-z0-9_-]+)`).exec(
            message?.text ?? '',
          );

          expect(match).not.toBeNull();
          token = match![1];
        },
        { timeout: 10_000, interval: 100 },
      );

      return token;
    }

    describe('GET /accounts/me', () => {
      it('200: devolve nome, e-mail decifrado e papel, sem endereço', async () => {
        const account = await createTestAccount(app, { role: UserRole.ADMIN });
        const accessToken = await signIn(account);

        const response = await authed(
          'get',
          '/accounts/me',
          accessToken,
        ).expect(200);

        expect(response.body).toEqual({
          id: account.id,
          name: expect.any(String),
          email: account.email,
          address: null,
          role: UserRole.ADMIN,
        });
      });

      it('não expõe senha, hash nem campos cifrados', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);

        const response = await authed(
          'get',
          '/accounts/me',
          accessToken,
        ).expect(200);

        expect(Object.keys(response.body as object).sort()).toEqual([
          'address',
          'email',
          'id',
          'name',
          'role',
        ]);
      });

      it('401 sem sessão', async () => {
        await authed('get', '/accounts/me', undefined).expect(401);
      });
    });

    describe('PATCH /accounts/me', () => {
      it('200: altera o nome', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);

        const response = await authed('patch', '/accounts/me', accessToken, {
          name: '  Maria de Souza  ',
        }).expect(200);

        expect(response.body.name).toBe('Maria de Souza');
        const user = await prisma.user.findUniqueOrThrow({
          where: { id_user: account.id },
        });
        expect(user.user_name).toBe('Maria de Souza');
      });

      it('200: grava o endereço cifrado e o devolve com o CEP só com dígitos', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);

        const response = await authed('patch', '/accounts/me', accessToken, {
          address: buildAddress(),
        }).expect(200);

        expect(response.body.address).toEqual(
          buildAddress({ postal_code: '01310100' }),
        );
        const user = await prisma.user.findUniqueOrThrow({
          where: { id_user: account.id },
        });
        // Nada do endereço fica em claro no banco.
        expect(user.address_encrypted).not.toBeNull();
        expect(user.address_encrypted).not.toContain('Paulista');
        expect(user.address_encrypted).not.toContain('01310');
      });

      it('o endereço gravado volta no GET /accounts/me', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);
        await authed('patch', '/accounts/me', accessToken, {
          address: buildAddress(),
        }).expect(200);

        const response = await authed(
          'get',
          '/accounts/me',
          accessToken,
        ).expect(200);

        expect(response.body.address).toMatchObject({
          street: 'Avenida Paulista',
          postal_code: '01310100',
        });
      });

      it('null remove o endereço', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);
        await authed('patch', '/accounts/me', accessToken, {
          address: buildAddress(),
        }).expect(200);

        const response = await authed('patch', '/accounts/me', accessToken, {
          address: null,
        }).expect(200);

        expect(response.body.address).toBeNull();
        const user = await prisma.user.findUniqueOrThrow({
          where: { id_user: account.id },
        });
        expect(user.address_encrypted).toBeNull();
      });

      it('mantém o e-mail e a senha legíveis depois da edição', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);

        await authed('patch', '/accounts/me', accessToken, {
          name: 'Outro Nome',
          address: buildAddress(),
        }).expect(200);

        const user = await prisma.user.findUniqueOrThrow({
          where: { id_user: account.id },
        });
        expect(
          encryption.decrypt({
            ciphertext: user.email_encrypted,
            keyVersion: user.encryption_key_version,
          }),
        ).toBe(account.email);
        await login(account.email, account.password).expect(200);
      });

      it('não altera o e-mail por este caminho', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);

        await authed('patch', '/accounts/me', accessToken, {
          name: 'Outro Nome',
          email: 'invasor@exemplo.com',
        }).expect(200);

        const response = await authed(
          'get',
          '/accounts/me',
          accessToken,
        ).expect(200);
        expect(response.body.email).toBe(account.email);
      });

      it('não afeta a conta de outro usuário', async () => {
        const account = await createTestAccount(app);
        const bystander = await createTestAccount(app);
        const accessToken = await signIn(account);
        const before = await prisma.user.findUniqueOrThrow({
          where: { id_user: bystander.id },
        });

        await authed('patch', '/accounts/me', accessToken, {
          name: 'Outro Nome',
          address: buildAddress(),
        }).expect(200);

        const after = await prisma.user.findUniqueOrThrow({
          where: { id_user: bystander.id },
        });
        expect(after.user_name).toBe(before.user_name);
        expect(after.address_encrypted).toBeNull();
      });

      it('422: corpo vazio', async () => {
        const accessToken = await signIn(await createTestAccount(app));

        await authed('patch', '/accounts/me', accessToken, {}).expect(422);
      });

      it('422: informa o campo do endereço inválido', async () => {
        const accessToken = await signIn(await createTestAccount(app));

        const response = await authed('patch', '/accounts/me', accessToken, {
          address: buildAddress({ state: 'XX' }),
        }).expect(422);

        expect(ErrorResponseSchema.parse(response.body).details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: 'address.state' }),
          ]),
        );
      });

      it('401 sem sessão', async () => {
        await authed('patch', '/accounts/me', undefined, {
          name: 'Nome',
        }).expect(401);
      });
    });

    describe('troca de e-mail', () => {
      const newEmail = () => faker.internet.email().toLowerCase();

      const requestChange = (
        accessToken: string | undefined,
        body: Record<string, unknown>,
      ) => authed('post', '/accounts/me/email-change', accessToken, body);

      const confirmChange = (token: string) =>
        request(app.getHttpServer())
          .post('/accounts/confirm-email-change')
          .send({ token });

      it('202: envia o link ao NOVO endereço, e o e-mail atual segue valendo', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);
        const target = newEmail();

        const response = await requestChange(accessToken, {
          new_email: target,
          current_password: account.password,
        }).expect(202);

        expect(response.body).toEqual({ message: expect.any(String) });
        await expect(
          tokenSentTo(target, 'confirmar-novo-email'),
        ).resolves.toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(mailProvider.sent.every(({ to }) => to === target)).toBe(true);
        // Até o link ser aberto, nada mudou.
        await login(account.email, account.password).expect(200);
        await login(target, account.password).expect(401);
      });

      it('guarda o novo e-mail só cifrado, com a versão da chave, e o token só como resumo', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);
        const target = newEmail();
        await requestChange(accessToken, {
          new_email: target,
          current_password: account.password,
        }).expect(202);
        const token = await tokenSentTo(target, 'confirmar-novo-email');

        const stored = await prisma.userToken.findFirstOrThrow();

        expect(stored.purpose).toBe(UserTokenPurpose.EMAIL_CHANGE);
        expect(stored.pending_email_encrypted).toMatch(/^\d+:[A-Za-z0-9_-]+$/);
        expect(JSON.stringify(stored)).not.toContain(target);
        expect(JSON.stringify(stored)).not.toContain(token);
      });

      it('422: senha atual incorreta, sem enviar nada', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);

        const response = await requestChange(accessToken, {
          new_email: newEmail(),
          current_password: buildPassword(),
        }).expect(422);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'INVALID_CURRENT_PASSWORD',
        );
        await expect(prisma.emailDispatchLog.count()).resolves.toBe(0);
        await expect(prisma.userToken.count()).resolves.toBe(0);
      });

      it('422: domínio da blacklist, gravado como o seeder grava', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);
        const domain = faker.internet.domainName();
        await prisma.blockedEmailDomain.create({
          data: { domain, origin: BlockedDomainOrigin.SEED },
        });

        const response = await requestChange(accessToken, {
          new_email: `${faker.internet.username()}@${domain}`,
          current_password: account.password,
        }).expect(422);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'EMAIL_DOMAIN_NOT_ALLOWED',
        );
        await expect(prisma.emailDispatchLog.count()).resolves.toBe(0);
      });

      it('422: o novo e-mail é o da própria conta', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);

        const response = await requestChange(accessToken, {
          new_email: account.email.toUpperCase(),
          current_password: account.password,
        }).expect(422);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'EMAIL_UNCHANGED',
        );
      });

      it('202 igual, sem enviar nada, quando o novo e-mail é de outra conta', async () => {
        const account = await createTestAccount(app);
        const other = await createTestAccount(app);
        const accessToken = await signIn(account);
        const free = await requestChange(accessToken, {
          new_email: newEmail(),
          current_password: account.password,
        }).expect(202);
        await vi.waitFor(() => expect(mailProvider.sent).toHaveLength(1), {
          timeout: 10_000,
          interval: 100,
        });

        const taken = await requestChange(accessToken, {
          new_email: other.email,
          current_password: account.password,
        }).expect(202);

        expect(taken.body).toEqual(free.body);
        await expect(prisma.emailDispatchLog.count()).resolves.toBe(1);
      });

      it('401 sem sessão', async () => {
        await requestChange(undefined, {
          new_email: newEmail(),
          current_password: buildPassword(),
        }).expect(401);
      });

      it('200: abrir o link efetiva a troca; o e-mail novo entra e o antigo não', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);
        const target = newEmail();
        await requestChange(accessToken, {
          new_email: target,
          current_password: account.password,
        }).expect(202);
        const token = await tokenSentTo(target, 'confirmar-novo-email');

        await confirmChange(token).expect(200);

        await login(target, account.password).expect(200);
        await login(account.email, account.password).expect(401);
      });

      it('atualiza o e-mail cifrado, o índice cego e a data de confirmação', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);
        const target = newEmail();
        await requestChange(accessToken, {
          new_email: target,
          current_password: account.password,
        }).expect(202);
        await confirmChange(
          await tokenSentTo(target, 'confirmar-novo-email'),
        ).expect(200);

        const user = await prisma.user.findUniqueOrThrow({
          where: { id_user: account.id },
        });
        expect(user.email_hash).toBe(encryption.blindIndex(target));
        expect(
          encryption.decrypt({
            ciphertext: user.email_encrypted,
            keyVersion: user.encryption_key_version,
          }),
        ).toBe(target);
        expect(user.email_confirmed_at).toBeInstanceOf(Date);
      });

      it('o GET /accounts/me passa a mostrar o e-mail novo, na mesma sessão', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);
        const target = newEmail();
        await requestChange(accessToken, {
          new_email: target,
          current_password: account.password,
        }).expect(202);
        await confirmChange(
          await tokenSentTo(target, 'confirmar-novo-email'),
        ).expect(200);

        const response = await authed(
          'get',
          '/accounts/me',
          accessToken,
        ).expect(200);

        expect(response.body.email).toBe(target);
      });

      it('o link só vale uma vez', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);
        const target = newEmail();
        await requestChange(accessToken, {
          new_email: target,
          current_password: account.password,
        }).expect(202);
        const token = await tokenSentTo(target, 'confirmar-novo-email');
        await confirmChange(token).expect(200);

        const response = await confirmChange(token).expect(400);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'USER_TOKEN_INVALID',
        );
      });

      it('pedir outra troca invalida o link anterior', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);
        const first = newEmail();
        const second = newEmail();
        await requestChange(accessToken, {
          new_email: first,
          current_password: account.password,
        }).expect(202);
        const firstToken = await tokenSentTo(first, 'confirmar-novo-email');
        await requestChange(accessToken, {
          new_email: second,
          current_password: account.password,
        }).expect(202);
        const secondToken = await tokenSentTo(second, 'confirmar-novo-email');

        await confirmChange(firstToken).expect(400);
        await confirmChange(secondToken).expect(200);

        await login(second, account.password).expect(200);
      });

      it('400: link expirado, e o e-mail segue o mesmo', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);
        const target = newEmail();
        await requestChange(accessToken, {
          new_email: target,
          current_password: account.password,
        }).expect(202);
        const token = await tokenSentTo(target, 'confirmar-novo-email');
        await prisma.userToken.updateMany({
          data: { expires_at: faker.date.recent() },
        });

        await confirmChange(token).expect(400);

        await login(account.email, account.password).expect(200);
      });

      it('400: link de outra finalidade não troca o e-mail', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);
        const target = newEmail();
        await requestChange(accessToken, {
          new_email: target,
          current_password: account.password,
        }).expect(202);
        const token = await tokenSentTo(target, 'confirmar-novo-email');
        await prisma.userToken.updateMany({
          data: { purpose: UserTokenPurpose.EMAIL_CONFIRMATION },
        });

        await confirmChange(token).expect(400);
      });

      it('409: o e-mail passou a ser de outra conta enquanto o link esperava', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);
        const target = newEmail();
        await requestChange(accessToken, {
          new_email: target,
          current_password: account.password,
        }).expect(202);
        const token = await tokenSentTo(target, 'confirmar-novo-email');
        // Outra pessoa se cadastra com o endereço no intervalo.
        const intruder = await createTestAccount(app);
        await prisma.user.update({
          where: { id_user: intruder.id },
          data: { email_hash: encryption.blindIndex(target) },
        });

        const response = await confirmChange(token).expect(409);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'EMAIL_ALREADY_IN_USE',
        );
        await login(account.email, account.password).expect(200);
      });

      it('a troca de e-mail é pública: o link funciona sem sessão', async () => {
        await confirmChange(faker.string.alphanumeric(43)).expect(400);
      });

      it('mantém as sessões abertas depois da troca', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);
        const target = newEmail();
        await requestChange(accessToken, {
          new_email: target,
          current_password: account.password,
        }).expect(202);
        await confirmChange(
          await tokenSentTo(target, 'confirmar-novo-email'),
        ).expect(200);

        await authed('get', '/accounts/me', accessToken).expect(200);
      });

      it('o e-mail de confirmação usa o template de troca', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);
        const target = newEmail();

        await requestChange(accessToken, {
          new_email: target,
          current_password: account.password,
        }).expect(202);
        await tokenSentTo(target, 'confirmar-novo-email');

        await expect(
          prisma.emailDispatchLog.findFirstOrThrow(),
        ).resolves.toMatchObject({
          template: EmailTemplate.EMAIL_CHANGE_CONFIRMATION,
        });
      });
    });

    describe('DELETE /accounts/me', () => {
      const deleteAccount = (
        accessToken: string | undefined,
        password: string,
      ) => authed('delete', '/accounts/me', accessToken, { password });

      it('204: exclui a conta e libera o e-mail para novo cadastro', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);

        await deleteAccount(accessToken, account.password).expect(204);

        await expect(prisma.user.count()).resolves.toBe(0);
        await request(app.getHttpServer())
          .post('/accounts')
          .send({
            name: faker.person.fullName(),
            email: account.email,
            password: buildPassword(),
          })
          .expect(202);
        await expect(prisma.user.count()).resolves.toBe(1);
      });

      it('o access token usado deixa de valer na requisição seguinte', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);
        await deleteAccount(accessToken, account.password).expect(204);

        await authed('get', '/accounts/me', accessToken).expect(401);
      });

      it('o refresh token e o login deixam de funcionar', async () => {
        const account = await createTestAccount(app);
        const { body } = await login(account.email, account.password).expect(
          200,
        );
        await deleteAccount(
          body.access_token as string,
          account.password,
        ).expect(204);

        await request(app.getHttpServer())
          .post('/auth/refresh')
          .send({ refresh_token: body.refresh_token })
          .expect(401);
        await login(account.email, account.password).expect(401);
      });

      it('remove sessões, tokens, bloqueios e chaves de API do titular', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);
        await signIn(account);
        await prisma.userToken.create({
          data: {
            user_id: account.id,
            purpose: UserTokenPurpose.PASSWORD_RESET,
            token_hash: faker.string.hexadecimal({ length: 64, prefix: '' }),
            expires_at: faker.date.soon(),
          },
        });
        await prisma.accessBlock.create({
          data: {
            scope: AccessBlockScope.USER,
            user_id: account.id,
            reason: AccessBlockReason.HONEYPOT,
          },
        });
        await prisma.apiKey.create({
          data: {
            user_id: account.id,
            key_name: 'integração',
            key_prefix: faker.string.alphanumeric(8),
            key_hash: faker.string.hexadecimal({ length: 64, prefix: '' }),
          },
        });

        await deleteAccount(accessToken, account.password).expect(204);

        await expect(
          prisma.userSession.count({ where: { user_id: account.id } }),
        ).resolves.toBe(0);
        await expect(prisma.userToken.count()).resolves.toBe(0);
        await expect(prisma.accessBlock.count()).resolves.toBe(0);
        await expect(prisma.apiKey.count()).resolves.toBe(0);
      });

      it('mantém as tentativas de login só com IP e data, desvinculadas do titular', async () => {
        const account = await createTestAccount(app);
        await login(account.email, buildPassword()).expect(401);
        const accessToken = await signIn(account);

        await deleteAccount(accessToken, account.password).expect(204);

        const attempts = await prisma.loginAttempt.findMany();
        expect(attempts).toHaveLength(2);
        for (const attempt of attempts) {
          expect(attempt.user_id).toBeNull();
          expect(attempt.ip).toEqual(expect.any(String));
          expect(attempt.attempted_at).toBeInstanceOf(Date);
        }
        expect(
          attempts.some(
            ({ failure_reason }) =>
              failure_reason === LoginFailureReason.INVALID_CREDENTIALS,
          ),
        ).toBe(true);
      });

      it('apaga os registros de e-mails enviados ao titular, e só os dele', async () => {
        const account = await createTestAccount(app);
        const bystander = await createTestAccount(app);
        const accessToken = await signIn(account);
        for (const user of [account, bystander]) {
          await prisma.emailDispatchLog.create({
            data: {
              user_id: user.id,
              template: EmailTemplate.SUSPICIOUS_LOGIN_ALERT,
              recipient_email_hash: encryption.blindIndex(user.email),
            },
          });
        }

        await deleteAccount(accessToken, account.password).expect(204);

        const logs = await prisma.emailDispatchLog.findMany();
        expect(logs).toHaveLength(1);
        expect(logs[0].user_id).toBe(bystander.id);
      });

      it('não afeta a conta nem as sessões de outro usuário', async () => {
        const account = await createTestAccount(app);
        const bystander = await createTestAccount(app);
        const accessToken = await signIn(account);
        const bystanderToken = await signIn(bystander);

        await deleteAccount(accessToken, account.password).expect(204);

        await authed('get', '/accounts/me', bystanderToken).expect(200);
        await expect(prisma.user.count()).resolves.toBe(1);
      });

      it('422: senha incorreta, sem excluir nada', async () => {
        const account = await createTestAccount(app);
        const accessToken = await signIn(account);

        const response = await deleteAccount(
          accessToken,
          buildPassword(),
        ).expect(422);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'INVALID_CURRENT_PASSWORD',
        );
        await expect(prisma.user.count()).resolves.toBe(1);
        await authed('get', '/accounts/me', accessToken).expect(200);
      });

      it('422: exige a senha', async () => {
        const accessToken = await signIn(await createTestAccount(app));

        await authed('delete', '/accounts/me', accessToken, {}).expect(422);
      });

      it('401 sem sessão', async () => {
        await deleteAccount(undefined, buildPassword()).expect(401);
      });
    });
  },
);
