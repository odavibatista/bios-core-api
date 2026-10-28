import type { INestApplication } from '@nestjs/common';
import { runCatalogSync } from '@app/cli/sync-catalog.runner.js';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { DataSourceCatalogSync } from '@modules/data-sources/infra/db/catalog-sync/data-source-catalog-sync.js';
import { DATA_SOURCES } from '@modules/data-sources/infra/db/seeders/data-sources.seeder.js';
import type { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { testDatabaseName } from '../support/infrastructure.js';

/**
 * Comando `catalog:sync` contra o MongoDB real (#256): um banco criado antes dos
 * ajustes do seed (IBAMA e GHG com valores antigos) recebe o que falta só sob
 * `--apply`, e a operação ajustada em produção é preservada.
 */
describe.runIf(inject('databaseAvailable'))(
  'Sincronização do catálogo de fontes (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    const seeded = (slug: string) => {
      const source = DATA_SOURCES.find((candidate) => candidate.slug === slug);

      if (!source) throw new Error(`fonte ${slug} fora do seed`);

      return source;
    };
    const lines: string[] = [];
    const run = (...argv: string[]) =>
      runCatalogSync(argv, {
        client: prisma,
        databaseName: testDatabaseName(),
        catalog: new DataSourceCatalogSync(),
        write: (line) => lines.push(line),
      });
    const snapshot = async () =>
      prisma.dataSource.findMany({ orderBy: { slug: 'asc' } });

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
    });

    beforeEach(async () => {
      lines.length = 0;
      await prisma.reset();
      await prisma.seed(CATALOG_SEEDERS);
      // Banco "antigo": o que o seed ganhou depois da primeira carga não chegou.
      await prisma.dataSource.update({
        where: { slug: 'IBAMA' },
        data: {
          base_url: 'https://dados.antigo.example/ibama',
          request_timeout_ms: 5_000,
          cache_ttl_seconds: null,
        },
      });
      await prisma.dataSource.update({
        where: { slug: 'GHG_PROTOCOL' },
        data: { base_url: 'https://registropublicodeemissoes.fgv.br' },
      });
      // Ajustes de operação em produção: a sincronização não pode desfazê-los.
      await prisma.dataSource.update({
        where: { slug: 'CGU_CEIS' },
        data: { rate_limit_per_minute: 30, is_enabled: false },
      });
      await prisma.dataSource.delete({ where: { slug: 'BRASIL_API' } });
    });

    afterAll(async () => {
      await prisma.reset();
      await app.close();
    });

    it('dry-run mostra a diferença antes de aplicar e não grava nada', async () => {
      const before = await snapshot();

      await expect(run()).resolves.toBe(0);

      expect(await snapshot()).toEqual(before);
      expect(lines).toContain('IBAMA: ATUALIZAR');
      expect(lines).toContain(
        '  base_url: "https://dados.antigo.example/ibama" -> "' +
          `${seeded('IBAMA').base_url}"`,
      );
      expect(lines).toContain('  request_timeout_ms: 5000 -> 600000');
      expect(lines).toContain('  cache_ttl_seconds: null -> 172800');
      expect(lines).toContain('GHG_PROTOCOL: ATUALIZAR');
      expect(lines).toContain('BRASIL_API: CRIAR (ausente no banco)');
      expect(lines).toContain(
        '  (mantido) rate_limit_per_minute: 30 no banco, 90 no seed',
      );
      expect(lines.at(-1)).toMatch(/Nada foi gravado/);
    });

    it('--apply corrige os valores antigos, cria a fonte ausente e preserva a operação', async () => {
      await expect(run('--apply')).resolves.toBe(0);

      const ibama = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: 'IBAMA' },
      });
      const ghg = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: 'GHG_PROTOCOL' },
      });
      const ceis = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: 'CGU_CEIS' },
      });

      expect(ibama).toMatchObject({
        base_url: seeded('IBAMA').base_url,
        request_timeout_ms: 600_000,
        cache_ttl_seconds: 172_800,
      });
      expect(ghg.base_url).toBe(seeded('GHG_PROTOCOL').base_url);
      await expect(
        prisma.dataSource.findUnique({ where: { slug: 'BRASIL_API' } }),
      ).resolves.toMatchObject({ role: 'CADASTRAL', fallback_priority: 1 });
      expect(ceis).toMatchObject({
        rate_limit_per_minute: 30,
        is_enabled: false,
      });
      expect(lines.at(-1)).toBe('Gravado: 1 criada(s), 2 atualizada(s).');
    });

    it('depois de aplicar, o dry-run seguinte não tem o que mudar', async () => {
      await run('--apply');
      lines.length = 0;

      await expect(run()).resolves.toBe(0);

      expect(lines).toContain('O catálogo já está em sincronia com o código.');
    });

    it('sem os ODS, recusa criar a fonte e não grava nada', async () => {
      await prisma.dataSource.updateMany({ data: { ods_id: null } });
      await prisma.ods.deleteMany();
      const before = await snapshot();

      await expect(run('--apply')).resolves.toBe(1);

      expect(lines.at(-1)).toMatch(/^Falha: .*ODS .* ausente/);
      expect(await snapshot()).toEqual(before);
    });
  },
);
