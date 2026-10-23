import type { PrismaClient } from '@prisma/client';
import {
  CATALOG_OPERATIONAL_FIELDS,
  CATALOG_SYNCED_FIELDS,
  planCatalogSync,
  type CatalogSyncPlan,
  type CatalogValue,
  type DesiredCatalogSource,
} from '../../../domain/catalog-sync.js';
import {
  DATA_SOURCES,
  DataSourcesSeeder,
} from '../seeders/data-sources.seeder.js';

/** O que o código declara para cada fonte, no formato da comparação. */
export function desiredCatalogSources(): DesiredCatalogSource[] {
  return DATA_SOURCES.map((source) => {
    const desired: DesiredCatalogSource = { slug: source.slug };

    for (const field of [
      ...CATALOG_SYNCED_FIELDS,
      ...CATALOG_OPERATIONAL_FIELDS,
    ]) {
      desired[field] = source[field];
    }

    return desired;
  });
}

export interface CatalogSyncResult {
  created: number;
  updated: number;
}

/**
 * Sincronização do catálogo de fontes com o seed, sob comando explícito (#256).
 *
 * Fora do ciclo de vida da API: nunca roda no boot nem em teste por conta própria.
 * `plan` só lê; `apply` grava e é idempotente (rodar de novo após uma interrupção
 * converge para o mesmo estado, pois cada `update` já é por fonte).
 */
export class DataSourceCatalogSync {
  /** Compara o banco com o seed, sem gravar nada. */
  async plan(client: PrismaClient): Promise<CatalogSyncPlan> {
    const rows = await client.dataSource.findMany({
      select: {
        slug: true,
        ...Object.fromEntries(
          [...CATALOG_SYNCED_FIELDS, ...CATALOG_OPERATIONAL_FIELDS].map(
            (field) => [field, true],
          ),
        ),
      },
    });

    return planCatalogSync(desiredCatalogSources(), rows);
  }

  /**
   * Grava o plano: cria as fontes ausentes e atualiza só os campos do contrato que
   * divergem. Campos operacionais (`is_enabled`, limite, prioridade) nunca são alterados
   * em fonte existente.
   *
   * @throws quando faltam ODS para criar fontes (o seeder recusa antes de gravar qualquer
   * coisa); carregue os ODS e rode de novo.
   */
  async apply(
    client: PrismaClient,
    plan: CatalogSyncPlan,
  ): Promise<CatalogSyncResult> {
    const toCreate = plan.entries.filter(({ action }) => action === 'CREATE');
    const toUpdate = plan.entries.filter(({ action }) => action === 'UPDATE');

    // O seeder só cria o que falta (e confere os ODS antes de gravar): reaproveitá-lo
    // garante que uma fonte criada aqui é igual à criada por ele.
    if (toCreate.length > 0) await new DataSourcesSeeder().run(client);

    for (const { slug, changes } of toUpdate) {
      const data: Record<string, CatalogValue> = {};

      for (const { field, to } of changes) data[field] = to;

      await client.dataSource.update({
        where: { slug },
        data: data,
      });
    }

    return { created: toCreate.length, updated: toUpdate.length };
  }
}
