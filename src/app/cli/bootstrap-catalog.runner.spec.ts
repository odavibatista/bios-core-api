import type { PrismaClient } from '@prisma/client';
import { DATA_SOURCES } from '@modules/data-sources/infra/db/seeders/data-sources.seeder.js';
import { REFERENCE_ODS } from '@modules/scoring/infra/db/seeders/ods.seeder.js';
import { SEED_BLOCKED_EMAIL_DOMAINS } from '@modules/security/infra/db/seeders/blocked-email-domains.seeder.js';
import type { DatabaseSeeder } from '@shared/infra/database/database-seeder.js';
import {
  formatBootstrapPlan,
  planCatalogBootstrap,
  runCatalogBootstrap,
} from './bootstrap-catalog.runner.js';

describe('comando catalog:bootstrap', () => {
  const findOds = vi.fn();
  const findSources = vi.fn();
  const findBlocked = vi.fn();
  const client = {
    ods: { findMany: findOds },
    dataSource: { findMany: findSources },
    blockedEmailDomain: { findMany: findBlocked },
  } as unknown as PrismaClient;
  const lines: string[] = [];
  const calls: string[] = [];
  const seeder = (name: string): DatabaseSeeder => ({
    name,
    run: vi.fn(() => {
      calls.push(name);

      return Promise.resolve();
    }),
  });
  let seeders: DatabaseSeeder[];

  const run = (...argv: string[]) =>
    runCatalogBootstrap(argv, {
      client,
      databaseName: 'bios',
      seeders,
      write: (line) => lines.push(line),
    });

  /** Banco vazio: nada carregado. */
  function emptyDatabase() {
    findOds.mockResolvedValue([]);
    findSources.mockResolvedValue([]);
    findBlocked.mockResolvedValue([]);
  }

  /** Banco já carregado, com tudo igual ao código. */
  function loadedDatabase() {
    findOds.mockResolvedValue([...REFERENCE_ODS]);
    findSources.mockResolvedValue(DATA_SOURCES.map(({ slug }) => ({ slug })));
    findBlocked.mockResolvedValue(
      SEED_BLOCKED_EMAIL_DOMAINS.map((domain) => ({ domain })),
    );
  }

  beforeEach(() => {
    lines.length = 0;
    calls.length = 0;
    seeders = [seeder('ods'), seeder('data-sources'), seeder('blacklist')];
    emptyDatabase();
  });

  describe('plano', () => {
    it('banco vazio: tudo a criar', async () => {
      const plan = await planCatalogBootstrap(client);

      expect(plan).toEqual({
        ods: { create: REFERENCE_ODS.length, update: 0, unchanged: 0 },
        dataSources: { create: DATA_SOURCES.length, existing: 0 },
        blockedDomains: {
          create: SEED_BLOCKED_EMAIL_DOMAINS.length,
          existing: 0,
        },
      });
    });

    it('banco carregado: nada a fazer', async () => {
      loadedDatabase();

      const plan = await planCatalogBootstrap(client);

      expect(plan.ods).toEqual({
        create: 0,
        update: 0,
        unchanged: REFERENCE_ODS.length,
      });
      expect(plan.dataSources).toEqual({
        create: 0,
        existing: DATA_SOURCES.length,
      });
      expect(plan.blockedDomains.create).toBe(0);
    });

    it('ODS com texto diferente do oficial: a atualizar', async () => {
      loadedDatabase();
      findOds.mockResolvedValue(
        REFERENCE_ODS.map((item, index) =>
          index === 0 ? { ...item, title: 'Título antigo' } : { ...item },
        ),
      );

      const plan = await planCatalogBootstrap(client);

      expect(plan.ods).toEqual({
        create: 0,
        update: 1,
        unchanged: REFERENCE_ODS.length - 1,
      });
    });

    it('ODS com só a descrição diferente da oficial também é a atualizar', async () => {
      loadedDatabase();
      findOds.mockResolvedValue(
        REFERENCE_ODS.map((item, index) =>
          index === 1
            ? { ...item, description: 'Descrição antiga' }
            : { ...item },
        ),
      );

      const plan = await planCatalogBootstrap(client);

      expect(plan.ods.update).toBe(1);
    });

    it('fonte e domínio que já existem não entram como a criar, ainda que o banco tenha a mais', async () => {
      loadedDatabase();
      findSources.mockResolvedValue([
        ...DATA_SOURCES.map(({ slug }) => ({ slug })),
        { slug: 'LEGADA' },
      ]);
      findBlocked.mockResolvedValue([
        ...SEED_BLOCKED_EMAIL_DOMAINS.map((domain) => ({ domain })),
      ]);

      const plan = await planCatalogBootstrap(client);

      expect(plan.dataSources.create).toBe(0);
      expect(plan.blockedDomains.create).toBe(0);
    });

    it('conta só os domínios do seed que faltam', async () => {
      findBlocked.mockResolvedValue(
        SEED_BLOCKED_EMAIL_DOMAINS.slice(0, 10).map((domain) => ({ domain })),
      );

      const plan = await planCatalogBootstrap(client);

      expect(plan.blockedDomains).toEqual({
        create: SEED_BLOCKED_EMAIL_DOMAINS.length - 10,
        existing: 10,
      });
    });

    it('formata uma linha por catálogo', async () => {
      const text = formatBootstrapPlan(await planCatalogBootstrap(client));

      expect(text).toHaveLength(3);
      expect(text[0]).toMatch(/^ODS: 2 a criar/);
      expect(text[1]).toMatch(/^Fontes de dados: 8 a criar/);
      expect(text[2]).toMatch(/^Blacklist de domínios: \d+ a criar/);
    });
  });

  describe('dry-run (padrão)', () => {
    it('mostra o plano e não roda nenhum seeder', async () => {
      await expect(run()).resolves.toBe(0);

      expect(calls).toEqual([]);
      expect(lines[0]).toBe('Banco: bios (dry-run, nada será gravado)');
      expect(lines).toContain(
        'Nada foi gravado. Rode com --apply para carregar o que está acima.',
      );
    });

    it('banco carregado: informa que já está carregado', async () => {
      loadedDatabase();

      await expect(run()).resolves.toBe(0);

      expect(lines).toContain('Os catálogos já estão carregados.');
      expect(lines).not.toContain(
        'Nada foi gravado. Rode com --apply para carregar o que está acima.',
      );
    });
  });

  describe('--apply', () => {
    it('roda os seeders na ordem de dependência', async () => {
      findOds.mockResolvedValueOnce([]).mockResolvedValue([...REFERENCE_ODS]);
      findSources
        .mockResolvedValueOnce([])
        .mockResolvedValue(DATA_SOURCES.map(({ slug }) => ({ slug })));
      findBlocked
        .mockResolvedValueOnce([])
        .mockResolvedValue(
          SEED_BLOCKED_EMAIL_DOMAINS.map((domain) => ({ domain })),
        );

      await expect(run('--apply')).resolves.toBe(0);

      expect(calls).toEqual(['ods', 'data-sources', 'blacklist']);
      expect(lines).toContain('Concluído: os catálogos estão carregados.');
      expect(lines[0]).toBe('Banco: bios (gravação (--apply))');
    });

    it('banco carregado: não roda seeder nenhum', async () => {
      loadedDatabase();

      await expect(run('--apply')).resolves.toBe(0);

      expect(calls).toEqual([]);
    });

    it('sai com falha se, depois de gravar, ainda faltar item', async () => {
      // O banco "não aprende": o plano de depois ainda vê tudo por criar.
      await expect(run('--apply')).resolves.toBe(1);

      expect(calls).toEqual(['ods', 'data-sources', 'blacklist']);
      expect(lines.at(-1)).toMatch(/^Atenção: ainda restam \d+ item/);
    });

    it('um seeder que falha interrompe a carga e sai com falha', async () => {
      seeders[1] = {
        name: 'data-sources',
        run: vi.fn(() => Promise.reject(new Error('ODS 13 ausente'))),
      };

      await expect(run('--apply')).resolves.toBe(1);

      expect(calls).toEqual(['ods']);
      expect(lines.at(-1)).toBe('Falha: ODS 13 ausente');
    });
  });

  describe('uso e falhas', () => {
    it('opção desconhecida: mostra o uso e sai com 2, sem tocar no banco', async () => {
      await expect(run('--force')).resolves.toBe(2);

      expect(lines[0]).toBe('Opção desconhecida: --force');
      expect(lines.some((line) => line.startsWith('Uso: npm run'))).toBe(true);
      expect(findOds).not.toHaveBeenCalled();
    });

    it('falha do banco: sai com 1 sem expor a connection string', async () => {
      findOds.mockRejectedValue(
        new Error('falha em mongodb://usuario:segredo@host:27017/bios'),
      );

      await expect(run()).resolves.toBe(1);

      expect(lines.at(-1)).toBe('Falha: falha em [conexão omitida]');
      expect(lines.join('\n')).not.toContain('segredo');
    });
  });
});
