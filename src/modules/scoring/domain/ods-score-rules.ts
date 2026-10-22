import {
  EvidenceCategory,
  EvidenceSignal,
  EvidenceState,
} from '@prisma/client';
import type { StoredEvidence } from '@modules/evidences/domain/dtos/repositories/evidence.repository.js';
import { EvidenceSourceUrlSchema } from '@modules/evidences/domain/evidence-provenance.js';
import type { CalculatedOdsScore } from './dtos/requests/calculate-ods-scores.dto.js';
import { calculateOdsConfidence } from './ods-confidence-rules.js';

export const ODS_SCORE_RULES_VERSION = 'rf10-rf11-v2';

type CategoryRule = Readonly<{
  category: EvidenceCategory;
  signal: EvidenceSignal;
  weight: number;
  cap: number;
}>;

/** Regras explícitas por ODS ativo. Nova seed exige novas regras antes do cálculo. */
export const ODS_SCORE_RULES: Readonly<
  Record<number, readonly CategoryRule[]>
> = {
  13: [
    {
      category: EvidenceCategory.EMISSAO_GEE,
      signal: EvidenceSignal.POSITIVE,
      weight: 60,
      cap: 100,
    },
  ],
  15: [
    {
      category: EvidenceCategory.INFRACAO_AMBIENTAL,
      signal: EvidenceSignal.NEGATIVE,
      weight: 40,
      cap: 80,
    },
    {
      category: EvidenceCategory.CONDUTA_ADMINISTRATIVA,
      signal: EvidenceSignal.NEGATIVE,
      weight: 5,
      cap: 20,
    },
  ],
};

export function scoreOdsEvidences(
  odsNumber: number,
  evidences: readonly StoredEvidence[],
  now: Date = new Date(),
): Pick<
  CalculatedOdsScore,
  'scoreValue' | 'confidenceValue' | 'evidenceCount' | 'contributions'
> {
  const rules = ODS_SCORE_RULES[odsNumber];
  if (!rules) throw new Error(`ODS ${odsNumber} sem regras de pontuacao.`);

  const contributions: CalculatedOdsScore['contributions'] = [];
  const usedByCategory = new Map<EvidenceCategory, number>();
  for (const evidence of [...evidences].sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.key.localeCompare(b.key) ||
      a.id.localeCompare(b.id),
  )) {
    const rule = rules.find((item) => item.category === evidence.category);
    if (!rule) continue;
    if (
      evidence.state !== EvidenceState.CONFIRMED ||
      evidence.validUntil <= now
    ) {
      continue;
    }
    if (evidence.signal !== rule.signal) {
      continue;
    }
    const traceable =
      Boolean(evidence.sourceReference?.trim()) ||
      EvidenceSourceUrlSchema.safeParse(evidence.sourceUrl).success;
    if (!traceable) {
      continue;
    }
    const used = usedByCategory.get(rule.category) ?? 0;
    const magnitude = Math.min(rule.weight, Math.max(0, rule.cap - used));
    usedByCategory.set(rule.category, used + magnitude);
    contributions.push({
      evidenceId: evidence.id,
      category: evidence.category,
      signal: rule.signal,
      weight: rule.weight,
      points: rule.signal === EvidenceSignal.POSITIVE ? magnitude : -magnitude,
    });
  }

  const count = contributions.length;
  const scoreValue = count
    ? contributions.reduce((total, item) => total + item.points, 0)
    : null;
  const confidenceValue = calculateOdsConfidence(
    odsNumber,
    evidences,
    new Set(contributions.map((item) => item.evidenceId)),
    now,
  );
  return { scoreValue, confidenceValue, evidenceCount: count, contributions };
}
