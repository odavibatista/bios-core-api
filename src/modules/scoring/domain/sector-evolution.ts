/** Janela de tempo de um agregado setorial: `[start, end)`. */
export interface SectorWindow {
  start: Date;
  end: Date;
}

/**
 * Janela do mês de `instant`, em UTC (RF30, #89).
 *
 * O mês é a janela adotada: longa o bastante para o índice de um setor mudar, curta o
 * bastante para uma série de um ano mostrar a tendência. O job roda todo dia e regrava o
 * mês corrente; virado o mês, o anterior fica como estava.
 */
export function monthlyWindow(instant: Date): SectorWindow {
  const year = instant.getUTCFullYear();
  const month = instant.getUTCMonth();

  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1)),
  };
}

/**
 * Divisão CNAE (2 primeiros dígitos) de um código CNAE, com ou sem máscara: é o setor dos
 * agregados (`sector_score_snapshots`), granularidade que evita amostras pequenas.
 *
 * Aceita a divisão (2 dígitos), o grupo (3), a classe (5) e a subclasse (7); `null` para o
 * que não é CNAE.
 */
export function cnaeDivisionOf(code: string): string | null {
  const digits = code.trim().replace(/[.\-/\s]/g, '');

  if (!/^\d{2}(\d|\d{3}|\d{5})?$/.test(digits)) return null;

  const division = digits.slice(0, 2);

  return division === '00' ? null : division;
}

/** Totais de um setor numa janela, antes da regra de amostra mínima. */
export interface SectorTotals {
  companyCount: number;
  scoredCompanyCount: number;
  averageScore: number | null;
  averageConfidence: number | null;
}

/**
 * Omite as médias de setor pequeno (IA05): com menos empresas que o mínimo, a média revelaria
 * o índice ou a confiança de uma empresa individual. As contagens ficam: dizem só quantas
 * empresas há, sem expor nenhuma.
 *
 * O índice médio é das empresas com índice; a confiança média, de todas as do setor.
 */
export function withMinimumSample(
  totals: SectorTotals,
  minimumCompanies: number,
): SectorTotals {
  return {
    ...totals,
    averageScore:
      totals.scoredCompanyCount >= minimumCompanies
        ? totals.averageScore
        : null,
    averageConfidence:
      totals.companyCount >= minimumCompanies ? totals.averageConfidence : null,
  };
}

/** Janelas a partir das quais há evolução a mostrar (UC10, fluxo 2.1). */
export const MINIMUM_EVOLUTION_WINDOWS = 2;
