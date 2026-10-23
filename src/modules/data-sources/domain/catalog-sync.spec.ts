import {
  CATALOG_OPERATIONAL_FIELDS,
  CATALOG_SYNCED_FIELDS,
  planCatalogSync,
  summarizeCatalogPlan,
  type CurrentCatalogSource,
  type DesiredCatalogSource,
} from './catalog-sync.js';

describe('planCatalogSync', () => {
  const desired: DesiredCatalogSource = {
    slug: 'IBAMA',
    name: 'IBAMA — Dados Abertos',
    base_url: 'https://novo.example/dados',
    role: 'EVIDENCE',
    ingestion_mode: 'DAILY_BATCH',
    evidence_category: 'INFRACAO_AMBIENTAL',
    request_timeout_ms: 600_000,
    cache_ttl_seconds: 172_800,
    rate_limit_per_minute: 30,
    is_enabled: undefined,
  };
  const inSync: CurrentCatalogSource = {
    ...desired,
    rate_limit_per_minute: 30,
  };

  it('fonte ausente no banco vira CREATE, sem campos a comparar', () => {
    const plan = planCatalogSync([desired], []);

    expect(plan.entries).toEqual([
      { slug: 'IBAMA', action: 'CREATE', changes: [], preserved: [] },
    ]);
  });

  it('banco igual ao código: UNCHANGED, sem diferenças', () => {
    const [entry] = planCatalogSync([desired], [inSync]).entries;

    expect(entry).toMatchObject({
      action: 'UNCHANGED',
      changes: [],
      preserved: [],
    });
  });

  it('valores antigos viram UPDATE com de -> para por campo', () => {
    const old: CurrentCatalogSource = {
      ...inSync,
      base_url: 'https://antigo.example',
      request_timeout_ms: 5_000,
      cache_ttl_seconds: undefined,
    };

    const [entry] = planCatalogSync([desired], [old]).entries;

    expect(entry.action).toBe('UPDATE');
    expect(entry.changes).toEqual([
      {
        field: 'base_url',
        from: 'https://antigo.example',
        to: 'https://novo.example/dados',
      },
      { field: 'request_timeout_ms', from: 5_000, to: 600_000 },
      { field: 'cache_ttl_seconds', from: null, to: 172_800 },
    ]);
  });

  it('campo operacional divergente é só informado: nunca vira mudança', () => {
    const tuned: CurrentCatalogSource = {
      ...inSync,
      rate_limit_per_minute: 5,
      is_enabled: false,
    };

    const [entry] = planCatalogSync(
      [{ ...desired, is_enabled: true }],
      [tuned],
    ).entries;

    expect(entry.action).toBe('UNCHANGED');
    expect(entry.changes).toEqual([]);
    expect(entry.preserved).toEqual([
      { field: 'is_enabled', current: false, seed: true },
      { field: 'rate_limit_per_minute', current: 5, seed: 30 },
    ]);
  });

  it('campo que o código não declara não é comparado nem apagado', () => {
    const withoutTtl: DesiredCatalogSource = { ...desired };
    delete withoutTtl.cache_ttl_seconds;
    const [entry] = planCatalogSync(
      [withoutTtl],
      [{ ...inSync, cache_ttl_seconds: 99 }],
    ).entries;

    expect(entry.action).toBe('UNCHANGED');
  });

  it('fonte no banco que o código não declara é só informada, em ordem', () => {
    const plan = planCatalogSync(
      [desired],
      [inSync, { slug: 'ZETA' }, { slug: 'ALFA' }],
    );

    expect(plan.unknownSlugs).toEqual(['ALFA', 'ZETA']);
  });

  it('o plano nunca muda campos operacionais: as listas não se cruzam', () => {
    const overlap = CATALOG_SYNCED_FIELDS.filter((field) =>
      (CATALOG_OPERATIONAL_FIELDS as readonly string[]).includes(field),
    );

    expect(overlap).toEqual([]);
  });

  it('resume quantas entradas há de cada ação', () => {
    const plan = planCatalogSync(
      [desired, { ...desired, slug: 'NOVA' }, { ...desired, slug: 'VELHA' }],
      [
        inSync,
        { ...inSync, slug: 'VELHA', base_url: 'https://antigo.example' },
      ],
    );

    expect(summarizeCatalogPlan(plan)).toEqual({
      CREATE: 1,
      UPDATE: 1,
      UNCHANGED: 1,
    });
  });
});
