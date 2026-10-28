import type { INestApplication } from '@nestjs/common';
import { runCatalogBootstrap } from '@app/cli/bootstrap-catalog.runner.js';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { DATA_SOURCES } from '@modules/data-sources/infra/db/seeders/data-sources.seeder.js';
import { REFERENCE_ODS } from '@modules/scoring/infra/db/seeders/ods.seeder.js';
import { SEED_BLOCKED_EMAIL_DOMAINS } from '@modules/security/infra/db/seeders/blocked-email-domains.seeder.js';
import type { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { testDatabaseName } from '../support/infrastructure.js';

/**
 * Comando `catalog:bootstrap` contra o MongoDB real (#329): um banco novo, sem nenhum
 * catálogo, recebe ODS, fontes e blacklist só sob `--apply`, uma segunda carga não altera
 * nada, e o que foi ajustado em produção (fontes, domínios removidos) é preservado.
 */
describe.runIf(inject('databaseAvailable'))(
  'Carga inicial dos catálogos (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    const lines: string[] = [];
    const run = (...argv: string[]) =>
      runCatalogBootstrap(argv, {
        client: prisma,
        databaseName: testDatabaseName(),
        seeders: CATALOG_SEEDERS,
        write: (line) => lines.push(line),
      });
    const counts = async () => ({
      ods: await prisma.ods.count(),
      sources: await prisma.dataSource.count(),
      blocked: await prisma.blockedEmailDomain.count(),
    });

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
    });

    beforeEach(async () => {
      lines.length = 0;
      await prisma.reset([
        'ods',
        'data_sources',
        'blocked_email_domains',
        'company_ods_scores',
      ]);
    });

    afterAll(async () => {
      await prisma.reset([
        'ods',
        'data_sources',
        'blocked_email_domains',
        'company_ods_scores',
      ]);
      await app.close();
    });

    it('banco vazio: o dry-run mostra o que falta e não grava nada', async () => {
      await expect(run()).resolves.toBe(0);

      expect(await counts()).toEqual({ ods: 0, sources: 0, blocked: 0 });
      expect(lines).toContain(
        `ODS: ${REFERENCE_ODS.length} a criar, 0 a atualizar (texto oficial), 0 iguais.`,
      );
      expect(lines).toContain(
        `Blacklist de domínios: ${SEED_BLOCKED_EMAIL_DOMAINS.length} a criar, 0 já existem.`,
      );
    });

    it('--apply carrega ODS, fontes e blacklist, na ordem em que dependem uns dos outros', async () => {
      await expect(run('--apply')).resolves.toBe(0);

      expect(await counts()).toEqual({
        ods: REFERENCE_ODS.length,
        sources: DATA_SOURCES.length,
        blocked: SEED_BLOCKED_EMAIL_DOMAINS.length,
      });
      expect(lines.at(-1)).toBe('Concluído: os catálogos estão carregados.');
    });

    it('o que foi carregado serve ao cálculo: ODS 13 e 15 ativos e fontes ligadas aos ODS', async () => {
      await run('--apply');

      const ods = await prisma.ods.findMany({
        where: { is_active: true },
        orderBy: { ods_number: 'asc' },
      });
      const ghg = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: 'GHG_PROTOCOL' },
        include: { ods: true },
      });

      expect(ods.map((item) => item.ods_number)).toEqual([13, 15]);
      expect(ghg.ods?.ods_number).toBe(13);
    });

    it('a blacklist carregada vem marcada como semente (SEED)', async () => {
      await run('--apply');

      expect(
        await prisma.blockedEmailDomain.count({ where: { origin: 'SEED' } }),
      ).toBe(SEED_BLOCKED_EMAIL_DOMAINS.length);
    });

    it('rodar de novo é idempotente: nada muda e informa que já está carregado', async () => {
      await run('--apply');
      const before = await counts();
      lines.length = 0;

      await expect(run('--apply')).resolves.toBe(0);

      expect(await counts()).toEqual(before);
      expect(lines).toContain('Os catálogos já estão carregados.');
    });

    it('preserva ajuste de operação numa fonte existente e não recria domínio removido pelo administrador', async () => {
      await run('--apply');
      await prisma.dataSource.update({
        where: { slug: 'CGU_CEIS' },
        data: { rate_limit_per_minute: 30, is_enabled: false },
      });
      const removed = SEED_BLOCKED_EMAIL_DOMAINS[0];
      await prisma.blockedEmailDomain.update({
        where: { domain: removed },
        data: { deleted_at: new Date() },
      });

      await expect(run('--apply')).resolves.toBe(0);

      const ceis = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: 'CGU_CEIS' },
      });
      const domain = await prisma.blockedEmailDomain.findUniqueOrThrow({
        where: { domain: removed },
      });

      expect(ceis).toMatchObject({
        rate_limit_per_minute: 30,
        is_enabled: false,
      });
      expect(domain.deleted_at).not.toBeNull();
      expect(await prisma.blockedEmailDomain.count()).toBe(
        SEED_BLOCKED_EMAIL_DOMAINS.length,
      );
    });

    it('carga parcial: completa só o que falta', async () => {
      await run('--apply');
      await prisma.dataSource.deleteMany({ where: { slug: 'IBAMA' } });
      await prisma.blockedEmailDomain.deleteMany({
        where: { domain: { in: SEED_BLOCKED_EMAIL_DOMAINS.slice(0, 5) } },
      });
      lines.length = 0;

      await expect(run('--apply')).resolves.toBe(0);

      expect(lines).toContain(
        `Fontes de dados: 1 a criar, ${DATA_SOURCES.length - 1} já existem (não são alteradas; veja catalog:sync).`,
      );
      expect(await counts()).toEqual({
        ods: REFERENCE_ODS.length,
        sources: DATA_SOURCES.length,
        blocked: SEED_BLOCKED_EMAIL_DOMAINS.length,
      });
    });

    it('o texto oficial do ODS é reaplicado se tiver sido alterado', async () => {
      await run('--apply');
      await prisma.ods.update({
        where: { ods_number: 15 },
        data: { title: 'Título alterado à mão' },
      });

      await expect(run('--apply')).resolves.toBe(0);

      const ods = await prisma.ods.findUniqueOrThrow({
        where: { ods_number: 15 },
      });

      expect(ods.title).toBe('Vida Terrestre');
    });
  },
);
