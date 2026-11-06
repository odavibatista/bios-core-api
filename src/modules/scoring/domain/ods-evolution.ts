import { EvidenceState, ScoreMovementCause } from '@prisma/client';
import type { StoredEvidence } from '@modules/evidences/domain/dtos/repositories/evidence.repository.js';
import { evidenceFactDate } from './ods-movement-rules.js';
import { scoreOdsContributions } from './ods-score-rules.js';

const DAY_MS = 86_400_000;
const FAR_FUTURE = new Date('2100-01-01T00:00:00.000Z');
const SAME_SCORE = 1e-9;

/** Por que a evolução de um ODS aparece ou não (RF36). */
export const OdsEvolutionStatus = {
  AVAILABLE: 'AVAILABLE',
  INDIVIDUAL_ENTREPRENEUR: 'INDIVIDUAL_ENTREPRENEUR',
  LEGAL_NATURE_PENDING: 'LEGAL_NATURE_PENDING',
  SHORT_HISTORY: 'SHORT_HISTORY',
  NO_DATED_EVIDENCE: 'NO_DATED_EVIDENCE',
  NOT_REPRODUCIBLE: 'NOT_REPRODUCIBLE',
} as const;

export type OdsEvolutionStatus =
  (typeof OdsEvolutionStatus)[keyof typeof OdsEvolutionStatus];

/** Um degrau: o índice a partir da data e a evidência que o causou (IND03, d). */
export interface OdsEvolutionStep {
  date: Date;
  scoreValue: number;
  cause: ScoreMovementCause;
  evidenceId: string;
  /** Quantas evidências mudaram o índice nessa data. */
  evidenceCount: number;
}

export interface OdsEvolution {
  status: OdsEvolutionStatus;
  steps: OdsEvolutionStep[];
}

export interface OdsEvolutionInput {
  odsNumber: number;
  /** Só as evidências que compõem o índice atual, de qualquer estado. */
  evidences: readonly StoredEvidence[];
  /** O índice gravado, que o último degrau precisa reproduzir. */
  scoreValue: number;
  /** Quando o índice foi calculado: nada depois disso entra na série. */
  calculatedAt: Date;
}

interface DatedEvidence {
  evidence: StoredEvidence;
  factDate: Date;
}

interface PointedContribution {
  evidenceId: string;
  points: number;
}

function detailsOf(evidence: StoredEvidence): Record<string, unknown> {
  const { details } = evidence;

  return details && typeof details === 'object' && !Array.isArray(details)
    ? details
    : {};
}

function dateOf(value: unknown): Date | null {
  if (typeof value !== 'string') return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function endOfDay(date: Date): Date {
  return new Date(Math.floor(date.getTime() / DAY_MS) * DAY_MS + DAY_MS - 1);
}

/**
 * A evidência como estava em `at`. Embargo baixado depois ainda valia inteiro, e a validade não
 * vale aqui: ela diz quando o BIOS precisa coletar de novo, e nada sobre o passado.
 */
function asOf(dated: readonly DatedEvidence[], at: Date): StoredEvidence[] {
  return dated
    .filter(({ factDate }) => factDate <= at)
    .map(({ evidence }) => {
      const details = detailsOf(evidence);
      const liftedAt = dateOf(details.lifted_at);
      const liftedLater = details.lifted === true && liftedAt && liftedAt > at;

      return {
        ...evidence,
        state: EvidenceState.CONFIRMED,
        validUntil: FAR_FUTURE,
        details: liftedLater ? { ...details, lifted: false } : evidence.details,
      };
    });
}

/**
 * Os dias em que o índice pode mudar: o do fato, o seguinte ao fim de uma sanção, quando ela passa
 * a pesar menos, e o da baixa de um embargo.
 */
function eventDays(dated: readonly DatedEvidence[], limit: Date): Date[] {
  const days = new Set<number>();
  const add = (date: Date | null) => {
    if (date && date <= limit) days.add(endOfDay(date).getTime());
  };

  for (const { evidence, factDate } of dated) {
    const details = detailsOf(evidence);
    const endDate = dateOf(details.endDate);

    add(factDate);
    add(endDate && new Date(endDate.getTime() + DAY_MS));
    add(dateOf(details.lifted_at));
  }

  return [...days].sort((a, b) => a - b).map((day) => new Date(day));
}

function sumOf(contributions: readonly PointedContribution[]): number | null {
  return contributions.length
    ? contributions.reduce((total, { points }) => total + points, 0)
    : null;
}

function changeBetween(
  before: readonly PointedContribution[],
  after: readonly PointedContribution[],
): Pick<OdsEvolutionStep, 'cause' | 'evidenceId' | 'evidenceCount'> | null {
  const points = new Map(
    before.map(({ evidenceId, points: value }) => [evidenceId, value]),
  );
  const added = after
    .filter(
      ({ evidenceId, points: value }) => value !== 0 && !points.has(evidenceId),
    )
    .map(({ evidenceId, points: value }) => ({
      evidenceId,
      effect: Math.abs(value),
    }));
  const reweighted = after.flatMap(({ evidenceId, points: value }) => {
    const previous = points.get(evidenceId);

    return previous === undefined || previous === value
      ? []
      : [{ evidenceId, effect: Math.abs(value - previous) }];
  });
  const [cause, changes] = added.length
    ? [ScoreMovementCause.EVIDENCE_ADDED, added]
    : [ScoreMovementCause.WEIGHT_CHANGED, reweighted];
  const [main] = [...changes].sort(
    (a, b) => b.effect - a.effect || a.evidenceId.localeCompare(b.evidenceId),
  );

  return main
    ? { cause, evidenceId: main.evidenceId, evidenceCount: changes.length }
    : null;
}

/**
 * Reconstrói a evolução do índice de um ODS (RF36): reaplica as regras vigentes às evidências que
 * compõem o índice atual, em cada dia em que ele pode ter mudado. Nada é gravado.
 *
 * Só há degrau quando o valor muda: uma evidência absorvida pelo teto da categoria não mexe no
 * índice. O último degrau precisa reproduzir o índice gravado; se não reproduzir, a série não é
 * entregue, porque mostraria um caminho que não leva ao número da tela.
 */
export function buildOdsEvolution({
  odsNumber,
  evidences,
  scoreValue,
  calculatedAt,
}: OdsEvolutionInput): OdsEvolution {
  const dated = evidences.flatMap((evidence) => {
    const factDate = evidenceFactDate(evidence.publishedAt, evidence.details);

    return factDate ? [{ evidence, factDate }] : [];
  });

  if (!dated.length) {
    return { status: OdsEvolutionStatus.NO_DATED_EVIDENCE, steps: [] };
  }

  const years = new Set(dated.map(({ factDate }) => factDate.getUTCFullYear()));

  if (years.size < 2) {
    return { status: OdsEvolutionStatus.SHORT_HISTORY, steps: [] };
  }

  const steps: OdsEvolutionStep[] = [];
  let contributions: readonly PointedContribution[] = [];
  let current: number | null = null;

  for (const day of eventDays(dated, calculatedAt)) {
    const at = day < calculatedAt ? day : calculatedAt;
    const next = scoreOdsContributions(odsNumber, asOf(dated, at), at);
    const value = sumOf(next);

    if (value !== null && value !== current) {
      const change = changeBetween(contributions, next);

      if (change) steps.push({ date: day, scoreValue: value, ...change });
    }

    contributions = next;
    current = value;
  }

  const final = sumOf(
    scoreOdsContributions(odsNumber, asOf(dated, calculatedAt), calculatedAt),
  );

  if (
    dated.length !== evidences.length ||
    final === null ||
    Math.abs(final - scoreValue) > SAME_SCORE ||
    Math.abs((steps.at(-1)?.scoreValue ?? Infinity) - scoreValue) > SAME_SCORE
  ) {
    return { status: OdsEvolutionStatus.NOT_REPRODUCIBLE, steps: [] };
  }

  return steps.length < 2
    ? { status: OdsEvolutionStatus.SHORT_HISTORY, steps: [] }
    : { status: OdsEvolutionStatus.AVAILABLE, steps };
}
