import { Test } from '@nestjs/testing';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { blockedEmailDomainFactory } from '@test/factories/security/blocked-email-domain.factory.js';
import { faker } from '@test/support/faker.js';
import { PrismaBlockedEmailDomainRepository } from './prisma-blocked-email-domain.repository.js';

describe('PrismaBlockedEmailDomainRepository', () => {
  const findFirst =
    vi.fn<() => Promise<{ id_blocked_email_domain: string } | null>>();
  let repository: PrismaBlockedEmailDomainRepository;

  beforeEach(async () => {
    findFirst.mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaBlockedEmailDomainRepository,
        {
          provide: PrismaService,
          useValue: { blockedEmailDomain: { findFirst } },
        },
      ],
    }).compile();

    repository = moduleRef.get(PrismaBlockedEmailDomainRepository);
  });

  it('procura o domínio exato, ignorando os removidos logicamente', async () => {
    const domain = faker.internet.domainName();

    await repository.isBlocked(domain);

    expect(findFirst).toHaveBeenCalledWith({
      where: { domain, deleted_at: null },
      select: { id_blocked_email_domain: true },
    });
  });

  it('reporta bloqueado quando há registro ativo', async () => {
    findFirst.mockResolvedValue(blockedEmailDomainFactory.build());

    await expect(
      repository.isBlocked(faker.internet.domainName()),
    ).resolves.toBe(true);
  });

  it('reporta liberado quando não há registro', async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      repository.isBlocked(faker.internet.domainName()),
    ).resolves.toBe(false);
  });
});
