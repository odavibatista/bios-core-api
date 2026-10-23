import {
  EvidenceCategory,
  EvidenceSignal,
  EvidenceState,
} from '@prisma/client';
import type { StoredEvidence } from '@modules/evidences/domain/dtos/repositories/evidence.repository.js';
import { EvidenceSourceUrlSchema } from '@modules/evidences/domain/evidence-provenance.js';
import type { CalculatedOdsScore } from './dtos/requests/calculate-ods-scores.dto.js';
import { calculateOdsConfidence } from './ods-confidence-rules.js';

export const ODS_SCORE_RULES_VERSION = 'rf10-rf11-v3';

function brazilianCivilDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (part: string) =>
    parts.find((item) => item.type === part)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function historicalReason(
  evidence: StoredEvidence,
  today: string,
): 'CGU_SANCTION_EXPIRED' | 'IBAMA_EMBARGO_LIFTED' | null {
  const details = evidence.details;
  if (!details || typeof details !== 'object' || Array.isArray(details))
    return null;
  if (
    evidence.category === EvidenceCategory.CONDUTA_ADMINISTRATIVA &&
    (evidence.sourceSlug === 'CGU_CEIS' ||
      evidence.sourceSlug === 'CGU_CNEP') &&
    typeof details.endDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(details.endDate) &&
    details.endDate < today
  )
    return 'CGU_SANCTION_EXPIRED';
  if (
    evidence.category === EvidenceCategory.INFRACAO_AMBIENTAL &&
    evidence.sourceSlug === 'IBAMA' &&
    details.resource === 'TERMO_EMBARGO' &&
    details.lifted === true
  )
    return 'IBAMA_EMBARGO_LIFTED';
  return null;
}

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
  const today = brazilianCivilDate(now);
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
    const weightReason = historicalReason(evidence, today);
    const weight = weightReason ? rule.weight * 0.25 : rule.weight;
    const used = usedByCategory.get(rule.category) ?? 0;
    const magnitude = Math.min(weight, Math.max(0, rule.cap - used));
    usedByCategory.set(rule.category, used + magnitude);
    contributions.push({
      evidenceId: evidence.id,
      category: evidence.category,
      signal: rule.signal,
      weight,
      weightReason,
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
