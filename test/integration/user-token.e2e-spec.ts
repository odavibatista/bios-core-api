import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { UserTokenPurpose } from '@prisma/client';
import { InvalidUserTokenException } from '@modules/accounts/domain/dtos/errors/invalid-user-token.exception.js';
import { AccountsModule } from '@modules/accounts/infra/modules/accounts.module.js';
import { ConsumeUserTokenUseCase } from '@modules/accounts/infra/usecases/consume-user-token.usecase.js';
import { IssueUserTokenUseCase } from '@modules/accounts/infra/usecases/issue-user-token.usecase.js';
import { validateEnvironment } from '@shared/config/environment.config.js';
import { DatabaseModule } from '@shared/infra/database/database.module.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { EncryptionModule } from '@shared/infra/modules/encryption.module.js';
import { QueueModule } from '@shared/infra/modules/queue.module.js';
import { inject } from 'vitest';
import { buildTestEnvironment } from '../support/environment.js';
import { faker } from '../support/faker.js';
import { testRedisUrl } from '../support/infrastructure.js';

const REDIS_URL = testRedisUrl();

/**
 * Tokens de uso único contra o banco real: a invalidação do link anterior e o
 * gasto único sob concorrência dependem de escritas condicionais e de
 * transação, que só o MongoDB exercita. O módulo de contas também carrega o
 * envio de e-mail, que exige a fila (Redis).
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Tokens de uso único com banco real (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let issue: IssueUserTokenUseCase;
    let consume: ConsumeUserTokenUseCase;
    let userId: string;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [
              () => validateEnvironment(buildTestEnvironment({ REDIS_URL })),
            ],
          }),
          DatabaseModule,
          EncryptionModule,
          QueueModule,
          AccountsModule,
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      await app.init();

      prisma = app.get(PrismaService);
      issue = app.get(IssueUserTokenUseCase);
      consume = app.get(ConsumeUserTokenUseCase);
    });

    beforeEach(async () => {
      const user = await prisma.user.create({
        data: {
          user_name: faker.person.firstName(),
          email_encrypted: faker.string.alphanumeric(40),
          email_hash: faker.string.hexadecimal({ length: 64, prefix: '' }),
          password_encrypted: faker.string.alphanumeric(60),
        },
      });
      userId = user.id_user;
    });

    afterEach(async () => {
      await prisma.reset(['user_tokens', 'users']);
    });

    afterAll(async () => {
      await app.close();
    });

    it('consome o token emitido e devolve o usuário', async () => {
      const { token } = await issue.execute({
        userId,
        purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
      });

      await expect(
        consume.execute({
          token,
          purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
        }),
      ).resolves.toEqual({ userId, pendingEmailEncrypted: null });
    });

    it('grava só o resumo do token', async () => {
      const { token } = await issue.execute({
        userId,
        purpose: UserTokenPurpose.PASSWORD_RESET,
      });

      const stored = await prisma.userToken.findFirstOrThrow({
        where: { user_id: userId },
      });

      expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(stored)).not.toContain(token);
    });

    it('não deixa o mesmo link ser usado duas vezes', async () => {
      const { token } = await issue.execute({
        userId,
        purpose: UserTokenPurpose.PASSWORD_RESET,
      });
      await consume.execute({
        token,
        purpose: UserTokenPurpose.PASSWORD_RESET,
      });

      await expect(
        consume.execute({ token, purpose: UserTokenPurpose.PASSWORD_RESET }),
      ).rejects.toBeInstanceOf(InvalidUserTokenException);
    });

    it('deixa passar só um de vários usos simultâneos do mesmo link', async () => {
      const { token } = await issue.execute({
        userId,
        purpose: UserTokenPurpose.PASSWORD_RESET,
      });

      const attempts = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          consume.execute({
            token,
            purpose: UserTokenPurpose.PASSWORD_RESET,
          }),
        ),
      );

      // Sem a escrita condicional, duas requisições trocariam a senha com o mesmo link.
      expect(
        attempts.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
    });

    it('invalida o link anterior quando um novo é pedido', async () => {
      const first = await issue.execute({
        userId,
        purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
      });
      const second = await issue.execute({
        userId,
        purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
      });

      await expect(
        consume.execute({
          token: first.token,
          purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
        }),
      ).rejects.toBeInstanceOf(InvalidUserTokenException);
      await expect(
        consume.execute({
          token: second.token,
          purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
        }),
      ).resolves.toMatchObject({ userId });
    });

    it('mantém válido o link de outra finalidade', async () => {
      const confirmation = await issue.execute({
        userId,
        purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
      });
      await issue.execute({ userId, purpose: UserTokenPurpose.PASSWORD_RESET });

      await expect(
        consume.execute({
          token: confirmation.token,
          purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
        }),
      ).resolves.toMatchObject({ userId });
    });

    it('recusa o link usado para outra finalidade', async () => {
      const { token } = await issue.execute({
        userId,
        purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
      });

      // Um link de confirmação de cadastro não pode redefinir senha.
      await expect(
        consume.execute({
          token,
          purpose: UserTokenPurpose.PASSWORD_RESET,
        }),
      ).rejects.toBeInstanceOf(InvalidUserTokenException);
    });

    it('recusa o link expirado, mesmo antes de o índice TTL removê-lo', async () => {
      const { token } = await issue.execute({
        userId,
        purpose: UserTokenPurpose.PASSWORD_RESET,
      });
      await prisma.userToken.updateMany({
        where: { user_id: userId },
        data: { expires_at: faker.date.recent() },
      });

      await expect(
        consume.execute({ token, purpose: UserTokenPurpose.PASSWORD_RESET }),
      ).rejects.toBeInstanceOf(InvalidUserTokenException);
    });

    it('recusa um token que nunca foi emitido', async () => {
      await expect(
        consume.execute({
          token: faker.string.alphanumeric(43),
          purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
        }),
      ).rejects.toBeInstanceOf(InvalidUserTokenException);
    });

    it('devolve o novo e-mail cifrado na troca de e-mail', async () => {
      const pendingEmailEncrypted = faker.string.alphanumeric(64);
      const { token } = await issue.execute({
        userId,
        purpose: UserTokenPurpose.EMAIL_CHANGE,
        pendingEmailEncrypted,
      });

      await expect(
        consume.execute({ token, purpose: UserTokenPurpose.EMAIL_CHANGE }),
      ).resolves.toEqual({ userId, pendingEmailEncrypted });
    });
  },
);
