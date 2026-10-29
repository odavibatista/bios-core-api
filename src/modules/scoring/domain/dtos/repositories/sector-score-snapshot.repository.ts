import type { SectorTotals, SectorWindow } from '../../sector-evolution.js';

/** Totais de um ODS num setor (divisão CNAE), lidos dos índices atuais. */
export interface SectorAggregate extends SectorTotals {
  odsId: string;
  cnaeDivision: string;
}

/** Agregado setorial gravado numa janela. */
export interface SectorScoreSnapshot extends SectorTotals {
  windowStart: Date;
  windowEnd: Date;
  rulesVersion: string;
}

/**
 * Contrato dos agregados setoriais (`sector_score_snapshots`, RF30, IA05): só médias e
 * contagens por setor, nunca índice de empresa.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class SectorScoreSnapshotRepository {
  /**
   * Totais por ODS e divisão do CNAE **principal** (do perfil cadastral) dos índices atuais
   * calculados pela versão de regras informada. Empresas sem perfil não têm setor e ficam
   * de fora.
   */
  abstract aggregateCurrentScores(
    rulesVersion: string,
  ): Promise<SectorAggregate[]>;

  /**
   * Substitui os agregados da janela pelos informados: grava cada um (o índice único por ODS,
   * setor e início da janela faz reexecutar sobrescrever, sem duplicar) e remove os da
   * janela que não vieram (setor que deixou de ter empresas).
   */
  abstract replaceWindow(
    window: SectorWindow,
    aggregates: readonly SectorAggregate[],
    rulesVersion: string,
  ): Promise<void>;

  /** Agregados de um ODS num setor, da janela mais antiga à mais recente. */
  abstract listEvolution(
    odsId: string,
    cnaeDivision: string,
  ): Promise<SectorScoreSnapshot[]>;

  /** Divisões CNAE com ao menos um agregado gravado, em ordem crescente. */
  abstract listDivisions(): Promise<string[]>;
}
