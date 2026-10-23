import type { PrismaClient } from '@prisma/client';
import {
  CATALOG_OPERATIONAL_FIELDS,
  type CatalogSyncPlan,
} from '../../../domain/catalog-sync.js';
import { DATA_SOURCES } from '../seeders/data-sources.seeder.js';
import {
  DataSourceCatalogSync,
  desiredCatalogSources,
} from './data-source-catalog-sync.js';

describe('DataSourceCatalogSync', () => {
  const rows = vi.fn();
  const update = vi.fn();
  const upsert = vi.fn();
  const odsFindMany = vi.fn();
  const client = {
    dataSource: { findMany: rows, update, upsert },
    ods: { findMany: odsFindMany },
  } as unknown as PrismaClient;
  const sync = new DataSourceCatalogSync();

  beforeEach(() => {
    rows.mockReset().mockResolvedValue([]);
    update.mockReset().mockResolvedValue({});
    upsert.mockReset().mockResolvedValue({});
    odsFindMany.mockReset().mockResolvedValue([
      { id_ods: 'ods-13', ods_number: 13 },
      { id_ods: 'ods-15', ods_number: 15 },
    ]);
  });

  it('declara, para cada fonte do seed, os campos do contrato e os operacionais', () => {
    const desired = desiredCatalogSources();
    const ibama = desired.find(({ slug }) => slug === 'IBAMA');

    expect(desired).toHaveLength(DATA_SOURCES.length);
    expect(ibama).toMatchObject({
      request_timeout_ms: 600_000,
      cache_ttl_seconds: 172_800,
    });
    for (const field of CATALOG_OPERATIONAL_FIELDS) {
      expect(Object.keys(ibama ?? {})).toContain(field);
    }
  });

  it('plan só lê: nunca grava', async () => {
    rows.mockResolvedValue([
      { slug: 'IBAMA', base_url: 'https://antigo.example' },
    ]);

    const plan = await sync.plan(client);

    expect(plan.entries.find(({ slug }) => slug === 'IBAMA')?.action).toBe(
      'UPDATE',
    );
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('apply atualiza só os campos do contrato que divergem, por fonte', async () => {
    const plan: CatalogSyncPlan = {
      entries: [
        {
          slug: 'IBAMA',
          action: 'UPDATE',
          changes: [
            {
              field: 'base_url',
              from: 'https://antigo.example',
              to: 'https://novo.example',
            },
            { field: 'request_timeout_ms', from: 5_000, to: 600_000 },
          ],
          preserved: [{ field: 'rate_limit_per_minute', current: 5, seed: 30 }],
        },
      ],
      unknownSlugs: [],
    };

    await expect(sync.apply(client, plan)).resolves.toEqual({
      created: 0,
      updated: 1,
    });

    expect(update).toHaveBeenCalledExactlyOnceWith({
      where: { slug: 'IBAMA' },
      data: { base_url: 'https://novo.example', request_timeout_ms: 600_000 },
    });
  });

  it('sem fonte a criar, não toca no seeder nem exige ODS', async () => {
    await sync.apply(client, {
      entries: [
        { slug: 'IBAMA', action: 'UNCHANGED', changes: [], preserved: [] },
      ],
      unknownSlugs: [],
    });

    expect(odsFindMany).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('fonte a criar passa pelo seeder, que só cria e confere os ODS antes', async () => {
    const plan: CatalogSyncPlan = {
      entries: [
        { slug: 'GHG_PROTOCOL', action: 'CREATE', changes: [], preserved: [] },
      ],
      unknownSlugs: [],
    };

    await expect(sync.apply(client, plan)).resolves.toEqual({
      created: 1,
      updated: 0,
    });

    expect(upsert).toHaveBeenCalledTimes(DATA_SOURCES.length);
    for (const [call] of upsert.mock.calls) {
      expect((call as { update: unknown }).update).toEqual({});
    }
  });

  it('sem os ODS, recusa antes de gravar qualquer coisa', async () => {
    odsFindMany.mockResolvedValue([]);

    await expect(
      sync.apply(client, {
        entries: [
          {
            slug: 'GHG_PROTOCOL',
            action: 'CREATE',
            changes: [],
            preserved: [],
          },
        ],
        unknownSlugs: [],
      }),
    ).rejects.toThrow(/ODS .* ausente/);

    expect(upsert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
