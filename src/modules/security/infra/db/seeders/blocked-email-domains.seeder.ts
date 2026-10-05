import { BlockedDomainOrigin, type PrismaClient } from '@prisma/client';
import { DatabaseSeeder } from '@shared/infra/database/database-seeder.js';
import seedDomains from './blocked-email-domains.json' with { type: 'json' };

/**
 * Domínios de e-mail descartáveis carregados do arquivo de sementes (RF22),
 * normalizados (minúsculas, sem espaços) e sem repetição.
 */
export const SEED_BLOCKED_EMAIL_DOMAINS: readonly string[] = [
  ...new Set(seedDomains.map((domain) => domain.trim().toLowerCase())),
].filter(Boolean);

/**
 * Popula a blacklist de domínios de e-mail (RF22).
 *
 * Insere em lote apenas os domínios ainda ausentes — uma consulta e uma
 * inserção, independentemente do tamanho da lista. Domínios já existentes não
 * são alterados: uma remoção lógica feita por um administrador (RF29) não é
 * desfeita por um novo seed.
 */
export class BlockedEmailDomainsSeeder extends DatabaseSeeder {
  override readonly name = 'blocked-email-domains';

  override async run(client: PrismaClient): Promise<void> {
    const existing = await client.blockedEmailDomain.findMany({
      where: { domain: { in: [...SEED_BLOCKED_EMAIL_DOMAINS] } },
      select: { domain: true },
    });
    const known = new Set(existing.map(({ domain }) => domain));
    const missing = SEED_BLOCKED_EMAIL_DOMAINS.filter(
      (domain) => !known.has(domain),
    );

    if (missing.length === 0) return;

    await client.blockedEmailDomain.createMany({
      data: missing.map((domain) => ({
        domain,
        origin: BlockedDomainOrigin.SEED,
      })),
    });
  }
}
