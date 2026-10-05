import type { PrismaClient } from '@prisma/client';
import {
  BlockedEmailDomainsSeeder,
  SEED_BLOCKED_EMAIL_DOMAINS,
} from './blocked-email-domains.seeder.js';

const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

function createClient(existingDomains: string[]) {
  const findMany = vi
    .fn()
    .mockResolvedValue(existingDomains.map((domain) => ({ domain })));
  const createMany = vi.fn().mockResolvedValue({ count: 0 });
  const client = {
    blockedEmailDomain: { findMany, createMany },
  } as unknown as PrismaClient;

  return { client, findMany, createMany };
}

describe('BlockedEmailDomainsSeeder', () => {
  it('carrega domínios válidos, normalizados e sem repetição do arquivo de sementes', () => {
    expect(SEED_BLOCKED_EMAIL_DOMAINS.length).toBeGreaterThan(0);
    expect(new Set(SEED_BLOCKED_EMAIL_DOMAINS).size).toBe(
      SEED_BLOCKED_EMAIL_DOMAINS.length,
    );

    const invalid = SEED_BLOCKED_EMAIL_DOMAINS.filter(
      (domain) => !DOMAIN.test(domain),
    );
    expect(invalid).toEqual([]);
  });

  it('insere em lote, com origem SEED, apenas os domínios ainda ausentes', async () => {
    const { client, findMany, createMany } = createClient(['mailinator.com']);

    await new BlockedEmailDomainsSeeder().run(client);

    expect(findMany).toHaveBeenCalledOnce();
    expect(createMany).toHaveBeenCalledOnce();

    const [{ data }] = createMany.mock.calls[0] as [
      { data: { domain: string; origin: string }[] },
    ];
    expect(data).toHaveLength(SEED_BLOCKED_EMAIL_DOMAINS.length - 1);
    expect(data).toContainEqual({ domain: 'yopmail.com', origin: 'SEED' });
    expect(data.map(({ domain }) => domain)).not.toContain('mailinator.com');
  });

  it('não insere nada quando todos os domínios já existem, preservando remoções lógicas', async () => {
    const { client, createMany } = createClient([
      ...SEED_BLOCKED_EMAIL_DOMAINS,
    ]);

    await new BlockedEmailDomainsSeeder().run(client);

    expect(createMany).not.toHaveBeenCalled();
  });
});
