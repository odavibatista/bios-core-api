import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BlockedDomainOrigin } from '@prisma/client';
import { BlockedEmailDomainException } from '@modules/security/domain/dtos/errors/blocked-email-domain.exception.js';
import { EmailDomainPolicyProvider } from '@modules/security/domain/providers/email-domain-policy.provider.js';
import { SecurityModule } from '@modules/security/infra/modules/security.module.js';
import { validateEnvironment } from '@shared/config/environment.config.js';
import { DatabaseModule } from '@shared/infra/database/database.module.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import { buildTestEnvironment } from '../support/environment.js';
import { faker } from '../support/faker.js';

/**
 * Blacklist de domínios contra o banco real: a remoção lógica e o efeito
 * imediato de uma alteração são comportamento da consulta, não do caso de uso.
 */
describe.runIf(inject('databaseAvailable'))(
  'Blacklist de domínios de e-mail com banco real (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let policy: EmailDomainPolicyProvider;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [() => validateEnvironment(buildTestEnvironment())],
          }),
          DatabaseModule,
          SecurityModule,
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      await app.init();

      prisma = app.get(PrismaService);
      policy = app.get(EmailDomainPolicyProvider);
    });

    afterEach(async () => {
      await prisma.reset(['blocked_email_domains']);
    });

    afterAll(async () => {
      await app.close();
    });

    /** Grava um domínio na blacklist, ativo ou removido logicamente. */
    function block(
      domain: string,
      deleted_at: Date | null = null,
    ): Promise<unknown> {
      return prisma.blockedEmailDomain.create({
        data: { domain, origin: BlockedDomainOrigin.SEED, deleted_at },
      });
    }

    function emailAt(domain: string): string {
      return `${faker.internet.username()}@${domain}`;
    }

    it('bloqueia domínio gravado sem o campo de remoção, como o seeder grava', async () => {
      const domain = faker.internet.domainName();
      // O MongoDB guarda campo opcional omitido como ausente, e não como null:
      // a consulta tem de tratar os dois como "não removido".
      await prisma.blockedEmailDomain.create({
        data: { domain, origin: BlockedDomainOrigin.SEED },
      });

      await expect(policy.execute(emailAt(domain))).rejects.toBeInstanceOf(
        BlockedEmailDomainException,
      );
    });

    it('deixa passar domínio que não está na lista', async () => {
      await block(faker.internet.domainName());

      await expect(
        policy.execute(emailAt(faker.internet.domainName())),
      ).resolves.toBeUndefined();
    });

    it('recusa domínio bloqueado, mesmo escrito em maiúsculas', async () => {
      const domain = faker.internet.domainName();
      await block(domain);

      await expect(
        policy.execute(emailAt(domain).toUpperCase()),
      ).rejects.toBeInstanceOf(BlockedEmailDomainException);
    });

    it('não bloqueia domínio removido logicamente', async () => {
      const domain = faker.internet.domainName();
      await block(domain, faker.date.recent());

      // O registro permanece para que uma reinclusão o restaure (RF29).
      await expect(policy.execute(emailAt(domain))).resolves.toBeUndefined();
    });

    it('não bloqueia por sufixo do domínio', async () => {
      const domain = faker.internet.domainName();
      await block(domain);

      await expect(
        policy.execute(emailAt(`nao${domain}`)),
      ).resolves.toBeUndefined();
    });

    it('vale na consulta seguinte quando um domínio é incluído', async () => {
      const domain = faker.internet.domainName();
      const email = emailAt(domain);
      await expect(policy.execute(email)).resolves.toBeUndefined();

      await block(domain);

      // Sem novo deploy e sem cache que sobreviva à alteração (RF22).
      await expect(policy.execute(email)).rejects.toBeInstanceOf(
        BlockedEmailDomainException,
      );
    });

    it('volta a liberar quando o domínio é removido', async () => {
      const domain = faker.internet.domainName();
      const email = emailAt(domain);
      await block(domain);
      await expect(policy.execute(email)).rejects.toThrow();

      await prisma.blockedEmailDomain.update({
        where: { domain },
        data: { deleted_at: new Date() },
      });

      await expect(policy.execute(email)).resolves.toBeUndefined();
    });
  },
);
