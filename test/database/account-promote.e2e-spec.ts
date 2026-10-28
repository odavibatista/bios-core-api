import type { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { runPromoteAccount } from '@app/cli/promote-account.runner.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import type { PrismaService } from '@shared/infra/database/prisma.service.js';
import request from 'supertest';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import {
  createTestAccount,
  type TestAccount,
} from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';
import { testDatabaseName, testRedisUrl } from '../support/infrastructure.js';

const REDIS_URL = testRedisUrl();
const collections = [
  'users',
  'user_sessions',
  'login_attempts',
  'access_blocks',
];

/**
 * Comando `account:promote` contra o MongoDB real (#329): troca o papel de uma conta e
 * encerra as sessões abertas, porque o papel viaja no access token. Prova o efeito pela API:
 * o token antigo deixa de valer e o novo login já traz o papel certo.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Promoção de conta a administrador (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let encryption: EncryptionProvider;
    const lines: string[] = [];
    const run = (...argv: string[]) =>
      runPromoteAccount(argv, {
        client: prisma,
        databaseName: testDatabaseName(),
        blindIndex: (value) => encryption.blindIndex(value),
        write: (line) => lines.push(line),
      });

    const login = async (account: TestAccount) => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);

      return response.body as {
        access_token: string;
        refresh_token: string;
        user: { role: UserRole };
      };
    };
    const me = (token: string) =>
      request(app.getHttpServer())
        .get('/accounts/me')
        .set('Authorization', `Bearer ${token}`);
    const roleOf = async (account: TestAccount) =>
      (await prisma.user.findUniqueOrThrow({ where: { id_user: account.id } }))
        .role;

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      encryption = app.get(EncryptionProvider);
    });

    beforeEach(async () => {
      lines.length = 0;
      await prisma.reset(collections);
      await resetThrottleCounters(REDIS_URL);
    });

    afterAll(async () => {
      await prisma.reset(collections);
      await app.close();
    });

    it('dry-run não altera o papel nem as sessões', async () => {
      const account = await createTestAccount(app);
      const session = await login(account);

      await expect(run('--email', account.email)).resolves.toBe(0);

      expect(await roleOf(account)).toBe(UserRole.USER);
      await me(session.access_token).expect(200);
      expect(lines).toContain(
        'Papel: USER -> ADMIN; 1 sessão(ões) aberta(s) serão encerradas.',
      );
    });

    it('--apply promove: o token antigo cai e o novo login já vem como ADMIN', async () => {
      const account = await createTestAccount(app);
      const before = await login(account);

      expect(before.user.role).toBe(UserRole.USER);
      await expect(run('--email', account.email, '--apply')).resolves.toBe(0);

      expect(await roleOf(account)).toBe(UserRole.ADMIN);
      await me(before.access_token).expect(401);
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: before.refresh_token })
        .expect(401);

      const after = await login(account);

      expect(after.user.role).toBe(UserRole.ADMIN);
      const profile = await me(after.access_token).expect(200);

      expect((profile.body as { role: UserRole }).role).toBe(UserRole.ADMIN);
    });

    it('registra o encerramento das sessões com o motivo ROLE_CHANGE', async () => {
      const account = await createTestAccount(app);
      await login(account);
      await login(account);

      await run('--email', account.email, '--apply');

      const sessions = await prisma.userSession.findMany({
        where: { user_id: account.id },
      });

      expect(sessions).toHaveLength(2);
      expect(
        sessions.every(
          (session) =>
            session.revoked_at !== null &&
            session.revocation_reason === 'ROLE_CHANGE',
        ),
      ).toBe(true);
    });

    it('aceita o e-mail em outra caixa e com espaços, como o login', async () => {
      const account = await createTestAccount(app);

      await expect(
        run('--email', `  ${account.email.toUpperCase()} `, '--apply'),
      ).resolves.toBe(0);

      expect(await roleOf(account)).toBe(UserRole.ADMIN);
    });

    it('só mexe na conta pedida: a de outro usuário segue com sessão e papel', async () => {
      const target = await createTestAccount(app);
      const other = await createTestAccount(app);
      const otherSession = await login(other);

      await run('--email', target.email, '--apply');

      expect(await roleOf(other)).toBe(UserRole.USER);
      await me(otherSession.access_token).expect(200);
    });

    it('conta sem e-mail confirmado não é promovida', async () => {
      const account = await createTestAccount(app, { active: false });

      await expect(run('--email', account.email, '--apply')).resolves.toBe(1);

      expect(await roleOf(account)).toBe(UserRole.USER);
    });

    it('conta inexistente: falha sem gravar nada', async () => {
      await expect(
        run('--email', 'ninguem@exemplo.com', '--apply'),
      ).resolves.toBe(1);
    });

    it('promover duas vezes é inofensivo e a segunda não encerra sessão', async () => {
      const account = await createTestAccount(app);
      await run('--email', account.email, '--apply');
      const session = await login(account);
      lines.length = 0;

      await expect(run('--email', account.email, '--apply')).resolves.toBe(0);

      expect(lines).toContain('A conta já é ADMIN: nada a alterar.');
      await me(session.access_token).expect(200);
    });

    describe('rebaixamento', () => {
      it('--demote devolve a USER e derruba o token de administrador', async () => {
        const admin = await createTestAccount(app, { role: UserRole.ADMIN });
        await createTestAccount(app, { role: UserRole.ADMIN });
        const session = await login(admin);

        await expect(
          run('--email', admin.email, '--demote', '--apply'),
        ).resolves.toBe(0);

        expect(await roleOf(admin)).toBe(UserRole.USER);
        await me(session.access_token).expect(401);
        expect((await login(admin)).user.role).toBe(UserRole.USER);
      });

      it('recusa rebaixar o último administrador ativo', async () => {
        const admin = await createTestAccount(app, { role: UserRole.ADMIN });
        await createTestAccount(app, {
          role: UserRole.ADMIN,
          active: false,
        });

        await expect(
          run('--email', admin.email, '--demote', '--apply'),
        ).resolves.toBe(1);

        expect(await roleOf(admin)).toBe(UserRole.ADMIN);
      });
    });
  },
);
