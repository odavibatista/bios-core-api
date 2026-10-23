/**
 * Sincronização explícita do catálogo de fontes (`data_sources`) com o que o código
 * declara (#256).
 *
 * O seeder só **cria** fontes ausentes: um banco antigo nunca recebe os ajustes
 * que o seed ganhou depois (ex.: `base_url` e timeout do IBAMA, host do GHG). Este
 * plano compara os dois lados e diz, campo a campo, o que mudaria, sem tocar em
 * nada: quem decide aplicar é o operador, com `--apply`.
 */

/** Campos que a sincronização grava: o contrato da fonte, e não o ajuste operacional. */
export const CATALOG_SYNCED_FIELDS = [
  'name',
  'base_url',
  'role',
  'ingestion_mode',
  'evidence_category',
  'request_timeout_ms',
  'cache_ttl_seconds',
] as const;

/**
 * Campos que a operação ajusta em produção (desligar uma fonte, baixar o limite,
 * reordenar a cadeia). Só valem na criação: a sincronização nunca os sobrescreve,
 * mas mostra quando o banco diverge do seed para que a divergência seja consciente.
 */
export const CATALOG_OPERATIONAL_FIELDS = [
  'is_enabled',
  'rate_limit_per_minute',
  'fallback_priority',
] as const;

export type CatalogSyncedField = (typeof CATALOG_SYNCED_FIELDS)[number];
export type CatalogOperationalField =
  (typeof CATALOG_OPERATIONAL_FIELDS)[number];

export type CatalogValue = string | number | boolean | null;

/** A fonte como o código a declara (valores `undefined` = não declarados, ficam como estão). */
export type DesiredCatalogSource = { slug: string } & Partial<
  Record<CatalogSyncedField | CatalogOperationalField, CatalogValue | undefined>
>;

/** A fonte como está no banco. */
export type CurrentCatalogSource = { slug: string } & Partial<
  Record<CatalogSyncedField | CatalogOperationalField, CatalogValue | undefined>
>;

export interface CatalogFieldChange {
  field: CatalogSyncedField;
  from: CatalogValue;
  to: CatalogValue;
}

export interface CatalogPreservedField {
  field: CatalogOperationalField;
  current: CatalogValue;
  seed: CatalogValue;
}

export type CatalogSyncAction = 'CREATE' | 'UPDATE' | 'UNCHANGED';

export interface CatalogSyncEntry {
  slug: string;
  action: CatalogSyncAction;
  /** Campos do contrato que mudariam (só em `UPDATE`). */
  changes: CatalogFieldChange[];
  /** Campos operacionais que divergem do seed e **não** serão tocados. */
  preserved: CatalogPreservedField[];
}

export interface CatalogSyncPlan {
  entries: CatalogSyncEntry[];
  /** Fontes que existem no banco e o código não declara: só informadas, nunca removidas. */
  unknownSlugs: string[];
}

const normalize = (value: CatalogValue | undefined): CatalogValue =>
  value === undefined ? null : value;

/**
 * Compara o que o código declara com o que está no banco.
 *
 * Função pura: não lê nem grava nada. Um campo não declarado pelo código
 * (`undefined`) não entra na comparação: a ausência no seed não apaga o valor do banco.
 */
export function planCatalogSync(
  desired: readonly DesiredCatalogSource[],
  current: readonly CurrentCatalogSource[],
): CatalogSyncPlan {
  const bySlug = new Map(current.map((source) => [source.slug, source]));
  const declared = new Set(desired.map(({ slug }) => slug));

  const entries = desired.map((want): CatalogSyncEntry => {
    const have = bySlug.get(want.slug);

    if (!have) {
      return { slug: want.slug, action: 'CREATE', changes: [], preserved: [] };
    }

    const changes: CatalogFieldChange[] = [];

    for (const field of CATALOG_SYNCED_FIELDS) {
      if (want[field] === undefined) continue;

      const to = normalize(want[field]);
      const from = normalize(have[field]);

      if (from !== to) changes.push({ field, from, to });
    }

    const preserved: CatalogPreservedField[] = [];

    for (const field of CATALOG_OPERATIONAL_FIELDS) {
      if (want[field] === undefined) continue;

      const seed = normalize(want[field]);
      const now = normalize(have[field]);

      if (now !== seed) preserved.push({ field, current: now, seed });
    }

    return {
      slug: want.slug,
      action: changes.length > 0 ? 'UPDATE' : 'UNCHANGED',
      changes,
      preserved,
    };
  });

  return {
    entries,
    unknownSlugs: current
      .map(({ slug }) => slug)
      .filter((slug) => !declared.has(slug))
      .sort(),
  };
}

/** Quantas entradas de cada ação, para o resumo. */
export function summarizeCatalogPlan(
  plan: CatalogSyncPlan,
): Record<CatalogSyncAction, number> {
  const summary: Record<CatalogSyncAction, number> = {
    CREATE: 0,
    UPDATE: 0,
    UNCHANGED: 0,
  };

  for (const { action } of plan.entries) summary[action] += 1;

  return summary;
}
