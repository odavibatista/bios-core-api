import type { PrismaClient } from '@prisma/client';
import type { CatalogSyncPlan } from '@modules/data-sources/domain/catalog-sync.js';
import type { DataSourceCatalogSync } from '@modules/data-sources/infra/db/catalog-sync/data-source-catalog-sync.js';
import { faker } from '@test/support/faker.js';
import { formatCatalogPlan, runCatalogSync } from './sync-catalog.runner.js';

describe('comando catalog:sync', () => {
  const client = {} as PrismaClient;
  const catalog = {
    plan: vi.fn<DataSourceCatalogSync['plan']>(),
    apply: vi.fn<DataSourceCatalogSync['apply']>(),
  };
  const lines: string[] = [];
  const run = (...argv: string[]) =>
    runCatalogSync(argv, {
      client,
      databaseName: 'bios',
      catalog: catalog,
      write: (line) => lines.push(line),
    });

  const drift: CatalogSyncPlan = {
    entries: [
      {
        slug: 'IBAMA',
        action: 'UPDATE',
        changes: [
          { field: 'request_timeout_ms', from: 5_000, to: 600_000 },
          { field: 'cache_ttl_seconds', from: null, to: 172_800 },
        ],
        preserved: [{ field: 'rate_limit_per_minute', current: 5, seed: 30 }],
      },
      { slug: 'GHG_PROTOCOL', action: 'CREATE', changes: [], preserved: [] },
      { slug: 'IBGE_CNAE', action: 'UNCHANGED', changes: [], preserved: [] },
    ],
    unknownSlugs: ['LEGADA'],
  };
  const inSync: CatalogSyncPlan = {
    entries: [
      { slug: 'IBAMA', action: 'UNCHANGED', changes: [], preserved: [] },
    ],
    unknownSlugs: [],
  };

  beforeEach(() => {
    lines.length = 0;
    catalog.plan.mockResolvedValue(drift);
    catalog.apply.mockResolvedValue({ created: 1, updated: 1 });
  });

  it('sem opção é dry-run: mostra o diff e não grava nada', async () => {
    await expect(run()).resolves.toBe(0);

    expect(catalog.apply).not.toHaveBeenCalled();
    expect(lines[0]).toBe('Banco: bios (dry-run, nada será gravado)');
    expect(lines).toContain('IBAMA: ATUALIZAR');
    expect(lines).toContain('  request_timeout_ms: 5000 -> 600000');
    expect(lines).toContain('  cache_ttl_seconds: null -> 172800');
    expect(lines).toContain('GHG_PROTOCOL: CRIAR (ausente no banco)');
    expect(lines).toContain('Resumo: 1 a criar, 1 a atualizar, 1 iguais.');
    expect(lines.at(-1)).toMatch(/Nada foi gravado\. Rode com --apply/);
  });

  it('mostra o que fica preservado e as fontes que o código não conhece', async () => {
    await run();

    expect(lines).toContain(
      '  (mantido) rate_limit_per_minute: 5 no banco, 30 no seed',
    );
    expect(lines).toContain(
      'LEGADA: está no banco e não no código (não é alterada)',
    );
  });

  it('com --apply grava o plano que foi mostrado', async () => {
    await expect(run('--apply')).resolves.toBe(0);

    expect(catalog.apply).toHaveBeenCalledWith(client, drift);
    expect(lines[0]).toBe('Banco: bios (gravação (--apply))');
    expect(lines.at(-1)).toBe('Gravado: 1 criada(s), 1 atualizada(s).');
  });

  it('catálogo em sincronia: avisa e não grava, mesmo com --apply', async () => {
    catalog.plan.mockResolvedValue(inSync);

    await expect(run('--apply')).resolves.toBe(0);

    expect(catalog.apply).not.toHaveBeenCalled();
    expect(lines.at(-1)).toBe('O catálogo já está em sincronia com o código.');
  });

  it('opção desconhecida: mostra o uso e sai com 2, sem tocar no banco', async () => {
    await expect(run('--force')).resolves.toBe(2);

    expect(catalog.plan).not.toHaveBeenCalled();
    expect(lines[0]).toBe('Opção desconhecida: --force');
    expect(lines.join('\n')).toMatch(/Uso: npm run catalog:sync/);
  });

  it('falha ao ler ou gravar: sai com 1 e nunca imprime a connection string', async () => {
    const password = faker.string.alphanumeric(24);
    catalog.plan.mockRejectedValue(
      new Error(`falha em mongodb://usuario:${password}@host:27017/bios agora`),
    );

    await expect(run('--apply')).resolves.toBe(1);

    expect(lines.at(-1)).toBe('Falha: falha em [conexão omitida] agora');
    expect(lines.join('\n')).not.toContain(password);
  });

  it('valor lançado que não é Error também vira falha legível', async () => {
    catalog.apply.mockRejectedValue('ODS 15 ausente');

    await expect(run('--apply')).resolves.toBe(1);

    expect(lines.at(-1)).toBe('Falha: ODS 15 ausente');
  });

  it('formatCatalogPlan lista cada fonte uma vez, na ordem do plano', () => {
    expect(
      formatCatalogPlan(drift).filter((line) => /^[A-Z_]+:/.test(line)),
    ).toEqual([
      'IBAMA: ATUALIZAR',
      'GHG_PROTOCOL: CRIAR (ausente no banco)',
      'IBGE_CNAE: igual',
      'LEGADA: está no banco e não no código (não é alterada)',
    ]);
  });
});
