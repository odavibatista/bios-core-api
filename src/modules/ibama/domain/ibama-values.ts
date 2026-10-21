/**
 * Número no formato brasileiro (`6932,00`, `12,5000`), ou `null` quando vazio
 * ou ilegível. Aceita o ponto de milhar (`1.234,56`).
 */
export function parseBrazilianNumber(text: string | undefined): number | null {
  const trimmed = text?.trim();

  if (!trimmed) return null;

  const value = Number(
    trimmed.includes(',')
      ? trimmed.replaceAll('.', '').replace(',', '.')
      : trimmed,
  );

  return Number.isFinite(value) ? value : null;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/;

/**
 * Data de um campo do dump (`2024-05-17` ou `2024-05-17 10:30:00`), como a
 * meia-noite UTC do **dia**, ou `null` quando vazio ou inválido.
 *
 * Só o dia importa: o dump não diz o fuso da hora (o Brasil tem mais de um), e
 * "publicado em" é uma data, não um instante.
 */
export function parseIbamaDate(text: string | undefined): Date | null {
  const match = DATE_PATTERN.exec(text?.trim() ?? '');

  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  // `new Date(Date.UTC(2024, 1, 31))` vira 2 de março: confere que o dia existe.
  return date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
    ? date
    : null;
}

/** Valor em reais (`R$ 6.932,00`), com espaço comum e não o inseparável do `Intl`. */
export function formatBrl(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
    .format(value)
    .replaceAll(' ', ' ');
}

/** Hectares (`12,5`), com até 4 casas, as do dump. */
export function formatHectares(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(
    value,
  );
}

/** Data como `17/05/2024`, pelo dia UTC. */
export function formatDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');

  return `${day}/${month}/${date.getUTCFullYear()}`;
}
