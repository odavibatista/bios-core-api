import {
  EvidenceCategory,
  EvidenceSignal,
  EvidenceState,
} from '@prisma/client';
import type { StoredEvidence } from '@modules/evidences/domain/dtos/repositories/evidence.repository.js';

type SourceRule = Readonly<{
  slug: string;
  category: EvidenceCategory;
  signal: EvidenceSignal;
  quality: number;
}>;

type OdsConfidenceRule = Readonly<{
  cap: number;
  sources: readonly SourceRule[];
}>;

/** Cobertura esperada e qualidade relativa das fontes do MVP (RF11). */
export const ODS_CONFIDENCE_RULES: Readonly<Record<number, OdsConfidenceRule>> =
  {
    13: {
      cap: 0.25,
      sources: [
        {
          slug: 'GHG_PROTOCOL',
          category: EvidenceCategory.EMISSAO_GEE,
          signal: EvidenceSignal.POSITIVE,
          quality: 1,
        },
      ],
    },
    15: {
      cap: 1,
      sources: [
        {
          slug: 'IBAMA',
          category: EvidenceCategory.INFRACAO_AMBIENTAL,
          signal: EvidenceSignal.NEGATIVE,
          quality: 1,
        },
        {
          slug: 'CGU_CEIS',
          category: EvidenceCategory.CONDUTA_ADMINISTRATIVA,
          signal: EvidenceSignal.NEGATIVE,
          quality: 0.25,
        },
        {
          slug: 'CGU_CNEP',
          category: EvidenceCategory.CONDUTA_ADMINISTRATIVA,
          signal: EvidenceSignal.NEGATIVE,
          quality: 0.25,
        },
      ],
    },
  };

/**
 * Calcula confiança sem usar o valor ou a magnitude do índice. Evidências
 * confirmadas elegíveis são os IDs das contribuições de RF10; NOT_FOUND vigente
 * só conta como resposta de fonte, nunca como achado conclusivo do índice.
 */
export function calculateOdsConfidence(
  odsNumber: number,
  evidences: readonly StoredEvidence[],
  contributingIds: ReadonlySet<string>,
  now: Date,
): number {
  const rule = ODS_CONFIDENCE_RULES[odsNumber];
  if (!rule) throw new Error(`ODS ${odsNumber} sem regras de confianca.`);
  if (contributingIds.size === 0) return 0;

  const answered = new Set<string>();
  const unknown = new Set<string>();
  const outdated = new Set<string>();
  let count = 0;
  let quality = 0;

  for (const evidence of evidences) {
    const source = rule.sources.find(
      (candidate) =>
        candidate.slug === evidence.sourceSlug &&
        candidate.category === evidence.category,
    );
    if (!source) continue;

    if (
      evidence.state === EvidenceState.OUTDATED ||
      (evidence.state !== EvidenceState.UNKNOWN && evidence.validUntil <= now)
    ) {
      outdated.add(source.slug);
      continue;
    }
    if (evidence.state === EvidenceState.UNKNOWN) {
      unknown.add(source.slug);
      continue;
    }
    if (evidence.state === EvidenceState.NOT_FOUND) {
      answered.add(source.slug);
      continue;
    }
    if (
      evidence.state === EvidenceState.CONFIRMED &&
      evidence.signal === source.signal &&
      contributingIds.has(evidence.id)
    ) {
      answered.add(source.slug);
      count++;
      quality += source.quality;
    }
  }

  if (count === 0) return 0;
  const covered = answered.size;
  const coverage = covered / rule.sources.length;
  const quantity = count / (count + 1);
  const evidenceQuality = (1 + quality) / (2 + quality);
  const recency = covered / (covered + unknown.size + outdated.size);
  return rule.cap * coverage * quantity * evidenceQuality * recency;
}
