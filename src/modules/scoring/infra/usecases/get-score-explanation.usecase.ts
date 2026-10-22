import { Injectable } from '@nestjs/common';
import { EvidenceState } from '@prisma/client';
import { projectEvidenceProvenance } from '@modules/evidences/domain/evidence-provenance.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import {
  ScoreExplanationRequestSchema,
  ScoreExplanationResponseSchema,
  type ScoreExplanationRequest,
  type ScoreExplanationResponse,
} from '../../domain/dtos/requests/score-explanation.dto.js';
import {
  ScoreExplanationStaleException,
  ScoreNotFoundException,
} from '../../domain/dtos/errors/score-explanation.errors.js';
import { OdsScoreRepository } from '../../domain/dtos/repositories/ods-score.repository.js';

/** RF12: explica o retrato persistido, sem refazer a coleta ou o índice. */
@Injectable()
export class GetScoreExplanationUseCase extends UseCase<
  ScoreExplanationRequest,
  ScoreExplanationResponse
> {
  constructor(
    private readonly scores: OdsScoreRepository,
    private readonly evidences: ListCompanyEvidencesUseCase,
  ) {
    super();
  }

  override async execute(
    input: ScoreExplanationRequest,
  ): Promise<ScoreExplanationResponse> {
    const { cnpj, odsNumber } = ScoreExplanationRequestSchema.parse(input);
    const score = await this.scores.findByCnpjAndOdsNumber(cnpj, odsNumber);
    if (!score) throw new ScoreNotFoundException();

    const contributions = score.contributions;
    const sum = contributions.reduce((total, item) => total + item.points, 0);
    if (
      score.evidenceCount !== contributions.length ||
      score.scoreValue !== (contributions.length ? sum : null) ||
      new Set(contributions.map((item) => item.evidenceId)).size !==
        contributions.length
    )
      throw new ScoreExplanationStaleException();

    if (!contributions.length)
      return ScoreExplanationResponseSchema.parse({
        cnpj,
        ods_number: odsNumber,
        index_status: 'UNAVAILABLE',
        score_value: null,
        confidence_value: score.confidenceValue,
        evidence_count: 0,
        rules_version: score.rulesVersion,
        calculated_at: score.calculatedAt.toISOString(),
        contributions: [],
      });

    const evidences = await this.evidences.execute(cnpj);
    const byId = new Map(evidences.map((item) => [item.id, item]));
    const explained = contributions.map((contribution) => {
      const evidence = byId.get(contribution.evidenceId);
      if (
        !evidence ||
        evidence.odsNumber !== odsNumber ||
        evidence.category !== contribution.category ||
        evidence.signal !== contribution.signal ||
        (evidence.state !== EvidenceState.CONFIRMED &&
          evidence.state !== EvidenceState.OUTDATED)
      )
        throw new ScoreExplanationStaleException();

      const provenance = projectEvidenceProvenance(evidence);
      if (!provenance.sourceReference && !provenance.sourceUrl)
        throw new ScoreExplanationStaleException();

      return {
        evidence: {
          id: evidence.id,
          category: contribution.category,
          source_slug: evidence.sourceSlug,
          source: evidence.sourceName,
          state: EvidenceState.CONFIRMED,
          current_state: evidence.state,
          source_reference: provenance.sourceReference,
          source_url: provenance.sourceUrl,
          collected_at: evidence.collectedAt.toISOString(),
          valid_until: evidence.validUntil.toISOString(),
        },
        weight: contribution.weight,
        signal: contribution.signal,
        points: contribution.points,
      };
    });

    return ScoreExplanationResponseSchema.parse({
      cnpj,
      ods_number: odsNumber,
      index_status: 'AVAILABLE',
      score_value: score.scoreValue,
      confidence_value: score.confidenceValue,
      evidence_count: score.evidenceCount,
      rules_version: score.rulesVersion,
      calculated_at: score.calculatedAt.toISOString(),
      contributions: explained,
    });
  }
}
