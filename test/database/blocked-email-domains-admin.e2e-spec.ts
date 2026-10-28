import type { INestApplication } from '@nestjs/common';
import { BlockedDomainOrigin, UserRole } from '@prisma/client';
import { MailProvider } from '@modules/mailing/domain/providers/mail.provider.js';
import {
  BlockedEmailDomainListResponseSchema,
  BlockedEmailDomainSchema,
} from '@modules/security/domain/dtos/requests/blocked-email-domain.dto.js';
import { ErrorResponseSchema } from '@shared/domain/dtos/errors/error-response.dto.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { Queue } from 'bullmq';
import request from 'supertest';
import { inject } from 'vitest';
import { buildPassword } from '../factories/shared/password.factory.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { faker } from '../support/faker.js';
import { testRedisUrl } from '../support/infrastructure.js';
import {
  createTestAccount,
  type TestAccount,
} from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';

const REDIS_URL = testRedisUrl();
const ROUTE = '/admin/blocked-email-domains';

/** Transporte dublê no lugar do SMTP: o cadastro envia o e-mail de confirmação. */
class SilentMailProvider extends MailProvider {
  override send(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Manutenção da blacklist pelo administrador (UC13, RF29, `[P12]`) contra banco, Redis e
 * fila reais: papel exigido, inclusão, remoção, reinclusão e o efeito imediato no cadastro.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Blacklist de domínios pelo administrador (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let admin: TestAccount;
    let adminToken: string;
    let userToken: string;

    const http = () => request(app.getHttpServer());
    const asAdmin = <T extends request.Test>(call: T) =>
      call.set('Authorization', `Bearer ${adminToken}`);

    async function login(account: TestAccount): Promise<string> {
      const { body } = await http()
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);

      return (body as { access_token: string }).access_token;
    }

    function register(email: string) {
      return http().post('/accounts').send({
        name: faker.person.fullName(),
        email,
        password: buildPassword(),
      });
    }

    const addDomain = (domain: unknown) =>
      asAdmin(http().post(ROUTE).send({ domain }));

    const list = (query: Record<string, number> = {}) =>
      asAdmin(http().get(ROUTE).query(query));

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp((builder) => {
        builder
          .overrideProvider(MailProvider)
          .useValue(new SilentMailProvider());
      }));
    });

    beforeEach(async () => {
      await resetThrottleCounters(REDIS_URL);
      await prisma.reset([
        'users',
        'user_sessions',
        'login_attempts',
        'user_tokens',
        'email_dispatch_logs',
        'blocked_email_domains',
      ]);
      admin = await createTestAccount(app, { role: UserRole.ADMIN });
      adminToken = await login(admin);
      userToken = await login(await createTestAccount(app));
    });

    afterAll(async () => {
      await prisma.reset([
        'users',
        'user_sessions',
        'login_attempts',
        'user_tokens',
        'email_dispatch_logs',
        'blocked_email_domains',
      ]);
      const queue = new Queue(QueueName.EMAIL_DISPATCH, {
        connection: { url: REDIS_URL },
      });
      await queue.obliterate({ force: true });
      await queue.close();
      await app.close();
    });

    describe('acesso (regra de negócio 1)', () => {
      const id = faker.database.mongodbObjectId();
      const calls = [
        ['GET', () => http().get(ROUTE)],
        ['POST', () => http().post(ROUTE).send({ domain: 'exemplo.com' })],
        ['DELETE', () => http().delete(`${ROUTE}/${id}`)],
      ] as const;

      it.each(calls)('%s sem sessão: 401', async (_method, call) => {
        await call().expect(401);
      });

      it.each(calls)('%s com sessão de USER: 403', async (_method, call) => {
        const response = await call()
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'INSUFFICIENT_ROLE',
        );
      });

      it('com chave de API, e sem sessão: 401 (a chave não autentica a administração)', async () => {
        const { body } = await asAdmin(
          http().post('/api-keys').send({ name: faker.lorem.word() }),
        ).expect(201);
        const { key } = body as { key: string };

        await http().get(ROUTE).set('X-API-Key', key).expect(401);
        await http()
          .get(ROUTE)
          .set('Authorization', `Bearer ${key}`)
          .expect(401);
      });
    });

    describe('inclusão (fluxos 3 e 4)', () => {
      it('valida, normaliza em minúsculas e grava com origem ADMIN e o administrador responsável', async () => {
        const domain = faker.internet.domainName();

        const response = await addDomain(`  ${domain.toUpperCase()} `).expect(
          201,
        );
        const created = BlockedEmailDomainSchema.parse(response.body);

        expect(created).toMatchObject({ domain, origin: 'ADMIN' });
        await expect(
          prisma.blockedEmailDomain.findUniqueOrThrow({ where: { domain } }),
        ).resolves.toMatchObject({
          id_blocked_email_domain: created.id,
          origin: BlockedDomainOrigin.ADMIN,
          created_by_user_id: admin.id,
        });
      });

      it.each(['@mailinator.com', 'fulano@mailinator.com', 'sem-ponto', ''])(
        'domínio inválido (%j): 422, nada gravado (fluxo 4.1)',
        async (domain) => {
          await addDomain(domain).expect(422);

          expect(await prisma.blockedEmailDomain.count()).toBe(0);
        },
      );

      it('domínio já bloqueado: 409, sem duplicar (fluxo 4.1)', async () => {
        const domain = faker.internet.domainName();
        await addDomain(domain).expect(201);

        const response = await addDomain(domain.toUpperCase()).expect(409);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'BLOCKED_EMAIL_DOMAIN_ALREADY_EXISTS',
        );
        expect(await prisma.blockedEmailDomain.count()).toBe(1);
      });

      it('inclusões simultâneas do mesmo domínio: uma grava, as outras recebem 409', async () => {
        const domain = faker.internet.domainName();

        const statuses = (
          await Promise.all(Array.from({ length: 5 }, () => addDomain(domain)))
        ).map(({ status }) => status);

        expect(statuses.filter((status) => status === 201)).toHaveLength(1);
        expect(statuses.filter((status) => status === 409)).toHaveLength(4);
        expect(await prisma.blockedEmailDomain.count()).toBe(1);
      });
    });

    describe('remoção e reinclusão (fluxo 3.1, RF29)', () => {
      it('remove logicamente; remover de novo, ou um id inexistente ou malformado, responde 404', async () => {
        const domain = faker.internet.domainName();
        const { body } = await addDomain(domain).expect(201);
        const { id } = BlockedEmailDomainSchema.parse(body);

        await asAdmin(http().delete(`${ROUTE}/${id}`)).expect(204);

        await expect(
          prisma.blockedEmailDomain.findUniqueOrThrow({ where: { domain } }),
        ).resolves.toMatchObject({ deleted_at: expect.any(Date) });
        await asAdmin(http().delete(`${ROUTE}/${id}`)).expect(404);
        await asAdmin(
          http().delete(`${ROUTE}/${faker.database.mongodbObjectId()}`),
        ).expect(404);
        const malformed = await asAdmin(
          http().delete(`${ROUTE}/nao-e-um-id`),
        ).expect(404);
        expect(ErrorResponseSchema.parse(malformed.body).code).toBe(
          'BLOCKED_EMAIL_DOMAIN_NOT_FOUND',
        );
      });

      it('reincluir um domínio removido restaura o mesmo registro, sem duplicar', async () => {
        const domain = faker.internet.domainName();
        const first = BlockedEmailDomainSchema.parse(
          (await addDomain(domain).expect(201)).body,
        );
        await asAdmin(http().delete(`${ROUTE}/${first.id}`)).expect(204);

        const again = BlockedEmailDomainSchema.parse(
          (await addDomain(domain).expect(201)).body,
        );

        expect(again.id).toBe(first.id);
        expect(await prisma.blockedEmailDomain.count()).toBe(1);
        await expect(
          prisma.blockedEmailDomain.findUniqueOrThrow({ where: { domain } }),
        ).resolves.toMatchObject({ deleted_at: null });
      });

      it('domínio da carga inicial removido e reincluído passa a constar como do administrador', async () => {
        const domain = faker.internet.domainName();
        const seeded = await prisma.blockedEmailDomain.create({
          data: {
            domain,
            origin: BlockedDomainOrigin.SEED,
            deleted_at: new Date(),
          },
        });

        const restored = BlockedEmailDomainSchema.parse(
          (await addDomain(domain).expect(201)).body,
        );

        expect(restored).toMatchObject({
          id: seeded.id_blocked_email_domain,
          origin: 'ADMIN',
        });
      });
    });

    describe('consulta (fluxo 2)', () => {
      it('lista só os ativos, em ordem alfabética, com a paginação', async () => {
        const domains = ['c-exemplo.com', 'a-exemplo.com', 'b-exemplo.com'];
        for (const domain of domains) await addDomain(domain).expect(201);
        // Domínio da carga inicial (criado sem `deleted_at`, como o seeder) e um removido.
        await prisma.blockedEmailDomain.create({
          data: { domain: 'd-exemplo.com', origin: BlockedDomainOrigin.SEED },
        });
        const { body } = await addDomain('e-exemplo.com').expect(201);
        await asAdmin(
          http().delete(`${ROUTE}/${BlockedEmailDomainSchema.parse(body).id}`),
        ).expect(204);

        const first = BlockedEmailDomainListResponseSchema.parse(
          (await list({ page: 1, page_size: 3 }).expect(200)).body,
        );
        const second = BlockedEmailDomainListResponseSchema.parse(
          (await list({ page: 2, page_size: 3 }).expect(200)).body,
        );

        expect(first.data.map(({ domain }) => domain)).toEqual([
          'a-exemplo.com',
          'b-exemplo.com',
          'c-exemplo.com',
        ]);
        expect(second.data).toEqual([
          expect.objectContaining({ domain: 'd-exemplo.com', origin: 'SEED' }),
        ]);
        expect(first.pagination).toEqual({
          page: 1,
          page_size: 3,
          total: 4,
          total_pages: 2,
        });
      });

      it('não expõe o administrador responsável nem a remoção lógica', async () => {
        await addDomain(faker.internet.domainName()).expect(201);

        const serialized = JSON.stringify((await list().expect(200)).body);

        expect(serialized).not.toContain('created_by');
        expect(serialized).not.toContain('deleted_at');
        expect(serialized).not.toContain(admin.id);
      });

      it('paginação fora do limite: 422', async () => {
        await list({ page_size: 101 }).expect(422);
        await list({ page: 0 }).expect(422);
      });
    });

    describe('efeito imediato e contas existentes (pós-condição e regra 3)', () => {
      it('o cadastro seguinte já respeita a inclusão e a remoção, sem novo deploy', async () => {
        const domain = faker.internet.domainName();
        const email = () =>
          `${faker.internet.username().toLowerCase()}@${domain}`;
        await register(email()).expect(202);

        const { body } = await addDomain(domain).expect(201);
        const blocked = await register(email()).expect(422);
        expect(ErrorResponseSchema.parse(blocked.body).code).toBe(
          'EMAIL_DOMAIN_NOT_ALLOWED',
        );

        await asAdmin(
          http().delete(`${ROUTE}/${BlockedEmailDomainSchema.parse(body).id}`),
        ).expect(204);
        await register(email()).expect(202);
      });

      it('bloquear o domínio não afeta a conta que já existe: ela continua entrando', async () => {
        const account = await createTestAccount(app);
        const [, domain] = account.email.split('@');

        await addDomain(domain).expect(201);

        await login(account);
        await expect(
          prisma.user.findUniqueOrThrow({ where: { id_user: account.id } }),
        ).resolves.toMatchObject({ is_active: true });
      });
    });
  },
);
