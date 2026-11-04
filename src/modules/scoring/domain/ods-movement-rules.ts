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
