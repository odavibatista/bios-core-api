import { EvidenceState } from '@prisma/client';
import type { StoredEvidence } from '@modules/evidences/domain/dtos/repositories/evidence.repository.js';
import { ODS_CONFIDENCE_RULES } from './ods-confidence-rules.js';

export const ODS_COVERAGE_STATUSES = [
  'HAS_RECORDS',
  'NO_RECORDS_IN_ALL_SOURCES',
  'NO_RECORDS_IN_SOME_SOURCES',
  'NO_DATA',
] as const;

export type OdsCoverageStatus = (typeof ODS_COVERAGE_STATUSES)[number];

export type OdsCoverage = Readonly<{
  coverageStatus: OdsCoverageStatus;
  sourcesWithoutRecords: string[];
}>;

/**
 * Distingue "consultado e sem registros" de "sem dados" (RF12, IND02). A ausência
 * vigente (NOT_FOUND) nunca pontua nem vira confiança: só informa a cobertura.
 * Uma fonte conta como "sem registros" quando sua resposta de ausência ainda está
 * dentro da validade e ela não tem achado confirmado vigente para o ODS.
 */
export function summarizeOdsCoverage(
  odsNumber: number,
  evidences: readonly StoredEvidence[],
  contributionCount: number,
  now: Date,
): OdsCoverage {
  const rule = ODS_CONFIDENCE_RULES[odsNumber];
  if (!rule) throw new Error(`ODS ${odsNumber} sem regras de confianca.`);

  const absent = new Set<string>();
  const confirmed = new Set<string>();
  for (const evidence of evidences) {
    const source = rule.sources.find(
      (candidate) =>
        candidate.slug === evidence.sourceSlug &&
        candidate.category === evidence.category,
    );
    if (!source || evidence.validUntil <= now) continue;
    if (evidence.state === EvidenceState.NOT_FOUND) absent.add(source.slug);
    if (evidence.state === EvidenceState.CONFIRMED) confirmed.add(source.slug);
  }

  const sourcesWithoutRecords = rule.sources
    .map((source) => source.slug)
    .filter((slug) => absent.has(slug) && !confirmed.has(slug));

  if (contributionCount > 0)
    return { coverageStatus: 'HAS_RECORDS', sourcesWithoutRecords };
  if (sourcesWithoutRecords.length === rule.sources.length)
    return {
      coverageStatus: 'NO_RECORDS_IN_ALL_SOURCES',
      sourcesWithoutRecords,
    };
  if (sourcesWithoutRecords.length > 0)
    return {
      coverageStatus: 'NO_RECORDS_IN_SOME_SOURCES',
      sourcesWithoutRecords,
    };
  return { coverageStatus: 'NO_DATA', sourcesWithoutRecords };
}
