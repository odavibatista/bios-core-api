import type { EvidenceCategory } from '@prisma/client';

/**
 * O que o catálogo diz sobre uma fonte de evidências: a categoria das
 * evidências que ela produz e o ODS a que se vinculam (RF08, RF10).
 *
 * Estes dois vêm do catálogo (`data_sources`), e não de uma tabela no código:
 * incluir uma fonte ou mudar seu ODS é uma alteração de seed, sem deploy.
 */
export interface EvidenceSourceConfig {
  /** Identificador da fonte (`data_sources.id_data_source`). */
  id: string;

  /** Identificador estável da fonte (ex.: `IBAMA`). */
  slug: string;

  /** Categoria das evidências da fonte. */
  category: EvidenceCategory;

  /** Identificador do ODS vinculado (`ods.id_ods`). */
  odsId: string;

  /** Número do ODS na Agenda 2030 (ex.: 15). */
  odsNumber: number;
}
