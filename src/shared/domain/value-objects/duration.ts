/** Quantidade de segundos de cada unidade aceita. */
const SECONDS_PER_UNIT = {
  w: 604_800,
  d: 86_400,
  h: 3_600,
  m: 60,
  s: 1,
} as const;

type DurationUnit = keyof typeof SECONDS_PER_UNIT;

/** Duração textual: inteiro seguido de unidade obrigatória (ex.: `45s`, `30m`, `12h`, `7d`, `4w`). */
export type DurationText = `${number}${DurationUnit}`;

const DURATION_PATTERN = /^(\d+)(w|d|h|m|s)$/;

/**
 * Intervalo de tempo imutável, com precisão de segundos.
 *
 * A forma textual exige a unidade explícita: um número sem unidade é rejeitado,
 * pois "90" pode significar segundos, minutos ou dias conforme quem lê.
 */
export class Duration {
  private constructor(private readonly seconds: number) {}

  /**
   * @throws {RangeError} quando `seconds` não é um inteiro seguro não negativo.
   */
  static ofSeconds(seconds: number): Duration {
    if (!Number.isSafeInteger(seconds) || seconds < 0) {
      throw new RangeError(
        `Duração inválida: ${seconds} segundos. Use um inteiro não negativo.`,
      );
    }

    return new Duration(seconds);
  }

  /**
   * Interpreta uma duração textual; devolve `undefined` quando o formato é inválido.
   */
  static tryParse(text: string): Duration | undefined {
    const match = DURATION_PATTERN.exec(text.trim().toLowerCase());
    if (!match) return undefined;

    const seconds =
      Number(match[1]) * SECONDS_PER_UNIT[match[2] as DurationUnit];

    return Number.isSafeInteger(seconds) ? new Duration(seconds) : undefined;
  }

  /**
   * Interpreta uma duração textual.
   *
   * @throws {RangeError} quando o formato é inválido.
   */
  static parse(text: string): Duration {
    const duration = Duration.tryParse(text);

    if (!duration) {
      throw new RangeError(
        `Duração inválida: "${text}". Use um inteiro seguido de unidade ` +
          '(s, m, h, d ou w), como 30m, 12h ou 7d.',
      );
    }

    return duration;
  }

  toSeconds(): number {
    return this.seconds;
  }

  toMilliseconds(): number {
    return this.seconds * 1_000;
  }

  isAtLeast(other: Duration): boolean {
    return this.seconds >= other.seconds;
  }

  equals(other: Duration): boolean {
    return this.seconds === other.seconds;
  }

  /**
   * Forma textual canônica, na maior unidade que representa a duração exatamente
   * (ex.: 604800 segundos → `1w`; 90 dias → `90d`).
   */
  toString(): DurationText {
    const unit = (Object.keys(SECONDS_PER_UNIT) as DurationUnit[]).find(
      (candidate) => this.seconds % SECONDS_PER_UNIT[candidate] === 0,
    ) as DurationUnit;

    return `${this.seconds / SECONDS_PER_UNIT[unit]}${unit}`;
  }
}
