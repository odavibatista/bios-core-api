import { EvidenceState } from '@prisma/client';
import type { EvidenceSourceConfig } from '@modules/data-sources/domain/dtos/providers/evidence-source.dto.js';
import { InvalidEvidenceError } from './dtos/errors/evidence.errors.js';
import type { EvidenceFinding } from './dtos/providers/evidence-collection.dto.js';
import type { EvidenceToSave } from './dtos/repositories/evidence.repository.js';
import { buildEvidenceKey } from './evidence-key.js';
import { signalForCategory } from './evidence-rules.js';

/** O que vale para todas as evidências de uma coleta de uma empresa numa fonte. */
export interface EvidenceBuildContext {
  cnpj: string;
  source: EvidenceSourceConfig;
  collectedAt: Date;
  validUntil: Date;
}

/**
 * Campos que toda evidência de uma fonte compartilha, qualquer que seja o
 * estado: a categoria e o ODS vêm do catálogo da fonte, e o sinal, da categoria.
 */
export function baseEvidence({
  cnpj,
  source,
  collectedAt,
  validUntil,
}: EvidenceBuildContext) {
  return {
    cnpj,
    dataSourceId: source.id,
    odsId: source.odsId,
    category: source.category,
    signal: signalForCategory(source.category),
    collectedAt,
    validUntil,
  };
}

/**
 * Evidência `CONFIRMED` de um registro da fonte.
 *
 * A chave usa a `identity` do registro quando a fonte a informa, e a
 * `reference` quando não: a referência que o órgão exibe nem sempre é única na
 * fonte (o IBAMA repete o número de um auto em linhas diferentes), e duas
 * evidências distintas não podem cair na mesma chave. A `reference` continua
 * sendo o que se mostra ao usuário (RF09).
 *
 * @throws {InvalidEvidenceError} quando o registro não tem referência.
 */
export function buildConfirmedEvidence(
  finding: EvidenceFinding,
  context: EvidenceBuildContext,
): EvidenceToSave {
  const reference = finding.reference.trim();

  if (reference === '') {
    throw new InvalidEvidenceError(
      `registro de "${context.source.slug}" sem referência no órgão de origem.`,
    );
  }

  const identity = finding.identity?.trim();

  return {
    ...baseEvidence(context),
    key: buildEvidenceKey(
      context.source.slug,
      context.cnpj,
      identity ? identity : reference,
    ),
    state: EvidenceState.CONFIRMED,
    summary: finding.summary ?? null,
    sourceReference: reference,
    sourceUrl: finding.url ?? null,
    details: finding.details ?? null,
    publishedAt: finding.publishedAt ?? null,
    rawEvidenceId: finding.rawEvidenceId ?? null,
  };
}
