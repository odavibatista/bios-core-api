import {
  ScoreMovementCause,
  ScoreMovementDirection,
  type EvidenceCategory,
} from '@prisma/client';

/** Uma contribuição, com o que a comparação precisa saber dela. */
export interface MovementContribution {
  evidenceId: string;
  category: EvidenceCategory;
  points: number;
}

/** O índice de um ODS, com o que a comparação precisa saber dele. */
export interface MovementScoreState {
  scoreValue: number | null;
  rulesVersion: string;
  contributions: readonly MovementContribution[];
}

/** O que aconteceu com o índice de um ODS. Nunca leva o índice anterior (IND03). */
export interface DetectedOdsMovement {
  direction: ScoreMovementDirection;
  cause: ScoreMovementCause;
  evidenceCategory: EvidenceCategory;
}

/** Uma contribuição que mudou, com o tamanho do seu efeito no índice. */
type Change = MovementContribution & { effect: number };

function directionOf(
  before: number | null,
  after: number | null,
): ScoreMovementDirection {
  if (before === null) return ScoreMovementDirection.AVAILABLE;
  if (after === null) return ScoreMovementDirection.UNAVAILABLE;

  return after > before
    ? ScoreMovementDirection.INCREASED
    : ScoreMovementDirection.DECREASED;
}

/** O desempate pelo identificador deixa o resultado igual em qualquer ordem de leitura. */
function strongest(changes: readonly Change[]): Change | undefined {
  return [...changes].sort(
    (a, b) => b.effect - a.effect || a.evidenceId.localeCompare(b.evidenceId),
  )[0];
}

/** Contribuições só de um lado, com efeito no índice: as que o teto zerou não mudam nada. */
function onlyIn(
  list: readonly MovementContribution[],
  other: readonly MovementContribution[],
): Change[] {
  const known = new Set(other.map(({ evidenceId }) => evidenceId));

  return list
    .filter((item) => item.points !== 0 && !known.has(item.evidenceId))
    .map((item) => ({ ...item, effect: Math.abs(item.points) }));
}

function reweighted(
  before: readonly MovementContribution[],
  after: readonly MovementContribution[],
): Change[] {
  const points = new Map(
    before.map((item) => [item.evidenceId, item.points] as const),
  );

  return after.flatMap((item) => {
    const previous = points.get(item.evidenceId);

    if (previous === undefined || previous === item.points) return [];

    return [{ ...item, effect: Math.abs(item.points - previous) }];
  });
}

/**
 * Compara um índice gravado com o novo e diz o que mudou (RF33; UC15, regras 5 e 6). Sem
 * mudança no valor do índice, não há movimentação: mudar só a confiança não conta.
 *
 * Índice calculado por outra versão das regras também não conta. Um recálculo em massa
 * mudaria o índice de muitas empresas sem que nada tivesse acontecido com elas, e a
 * movimentação seria apresentada como um fato sobre a empresa (IA05, IND03).
 */
export function detectOdsMovement(
  previous: MovementScoreState | null,
  next: MovementScoreState,
): DetectedOdsMovement | null {
  if (previous && previous.rulesVersion !== next.rulesVersion) return null;

  const before = previous?.scoreValue ?? null;
  const after = next.scoreValue;

  if (before === after) return null;

  const old = previous?.contributions ?? [];
  const added = onlyIn(next.contributions, old);
  const removed = onlyIn(old, next.contributions);
  const [cause, changes] = added.length
    ? [ScoreMovementCause.EVIDENCE_ADDED, added]
    : removed.length
      ? [ScoreMovementCause.EVIDENCE_REMOVED, removed]
      : [
          ScoreMovementCause.WEIGHT_CHANGED,
          reweighted(old, next.contributions),
        ];
  const main = strongest(changes);

  // O índice é a soma das contribuições: só um retrato antigo inconsistente chega aqui, e
  // ele não pode derrubar o recálculo que o corrige.
  if (!main) return null;

  return {
    direction: directionOf(before, after),
    cause,
    evidenceCategory: main.category,
  };
}

/** Uma contribuição com a data do fato registrado pela evidência, quando se sabe. */
export interface DatedContribution extends MovementContribution {
  evidenceDate: Date | null;
}

function dateOf(value: unknown): Date | null {
  if (typeof value !== 'string') return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Quando o fato registrado pela evidência aconteceu: a publicação ou, sem ela, o início da sanção
 * (CEIS/CNEP) ou o fim do ano do inventário (GHG). A data de coleta nunca entra: ela diz quando o
 * BIOS leu o dado, e uma sanção antiga apareceria como se fosse de hoje.
 */
export function evidenceFactDate(
  publishedAt: Date | null,
  details: unknown,
): Date | null {
  if (publishedAt) return publishedAt;

  const { startDate, inventoryYear } = (details ?? {}) as Record<
    string,
    unknown
  >;

  return (
    dateOf(startDate) ??
    (typeof inventoryYear === 'number'
      ? new Date(Date.UTC(inventoryYear, 11, 31))
      : null)
  );
}

export interface ReconstructedOdsMovement extends DetectedOdsMovement {
  movedAt: Date;
}

/**
 * A movimentação de um índice sem registro de mudança (RF33 c; UC15, regra 8), deduzida da
 * evidência mais recente que pontua: foi ela que deu ao índice o valor atual. Sem data
 * utilizável, ou só com data futura, não há o que afirmar, e nada é reconstruído.
 */
export function reconstructOdsMovement(
  contributions: readonly DatedContribution[],
  now: Date,
): ReconstructedOdsMovement | null {
  const scoring = contributions.filter(({ points }) => points !== 0);
  const [latest] = scoring
    .filter(({ evidenceDate }) => evidenceDate && evidenceDate <= now)
    .sort(
      (a, b) =>
        b.evidenceDate!.getTime() - a.evidenceDate!.getTime() ||
        Math.abs(b.points) - Math.abs(a.points) ||
        a.evidenceId.localeCompare(b.evidenceId),
    );

  if (!latest) return null;

  const signed =
    latest.points > 0
      ? ScoreMovementDirection.INCREASED
      : ScoreMovementDirection.DECREASED;

  return {
    direction: scoring.length === 1 ? ScoreMovementDirection.AVAILABLE : signed,
    cause: ScoreMovementCause.EVIDENCE_ADDED,
    evidenceCategory: latest.category,
    movedAt: latest.evidenceDate!,
  };
}
