import { Injectable, Logger } from '@nestjs/common';
import { CompanyNotFoundException } from '@modules/companies/domain/dtos/errors/company-not-found.exception.js';
import { InvalidCnpjException } from '@modules/companies/domain/dtos/errors/invalid-cnpj.exception.js';
import { CompanyProfileRepository } from '@modules/companies/domain/dtos/repositories/company-profile.repository.js';
import { isIndividualEntrepreneur } from '@modules/companies/domain/legal-nature.js';
import type { StoredEvidence } from '@modules/evidences/domain/dtos/repositories/evidence.repository.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import type { CompanyOdsScore } from '@modules/scoring/domain/dtos/requests/company-ods-scores.dto.js';
import {
  buildOdsEvolution,
  OdsEvolutionStatus,
} from '@modules/scoring/domain/ods-evolution.js';
import { GetCompanyOdsScoresUseCase } from '@modules/scoring/infra/usecases/get-company-ods-scores.usecase.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import type { CompanyIndexEvolution } from '../../domain/dtos/requests/company-index-evolution.dto.js';

type OdsEvolutionResponse = CompanyIndexEvolution['ods'][number];

/**
 * Evolução do índice de uma empresa (UC07, RF36), calculada na leitura e nunca gravada.
 *
 * Cadastro de empresário individual não tem série: a curva ficaria ligada a uma pessoa (nota do
 * IA05). Sem natureza jurídica conhecida, a série também não sai, porque esse cadastro pode ser de
 * uma pessoa. A resposta diz o motivo, para a tela explicar a ausência do gráfico.
 */
@Injectable()
export class GetCompanyIndexEvolutionUseCase extends UseCase<
  string,
  CompanyIndexEvolution
> {
  private readonly logger = new Logger(GetCompanyIndexEvolutionUseCase.name);

  constructor(
    private readonly profiles: CompanyProfileRepository,
    private readonly scores: GetCompanyOdsScoresUseCase,
    private readonly evidences: ListCompanyEvidencesUseCase,
  ) {
    super();
  }

  override async execute(input: string): Promise<CompanyIndexEvolution> {
    const cnpj = parseCnpj(input);

    if (!cnpj) throw new InvalidCnpjException();

    const stored = await this.profiles.findByCnpj(cnpj);

    if (!stored) throw new CompanyNotFoundException();

    const code = stored.profile.legal_nature_code;
    const scores = await this.scores.execute(cnpj);
    const blocked =
      code === null
        ? OdsEvolutionStatus.LEGAL_NATURE_PENDING
        : isIndividualEntrepreneur(code)
          ? OdsEvolutionStatus.INDIVIDUAL_ENTREPRENEUR
          : null;

    if (blocked) {
      return {
        cnpj,
        reconstructed: true,
        ods: scores.map(({ ods_number }) => ({
          ods_number,
          status: blocked,
          steps: [],
        })),
      };
    }

    const evidences = new Map(
      (await this.evidences.execute(cnpj)).map((item) => [item.id, item]),
    );

    return {
      cnpj,
      reconstructed: true,
      ods: scores.map((score) => this.evolutionOf(cnpj, score, evidences)),
    };
  }

  private evolutionOf(
    cnpj: string,
    score: CompanyOdsScore,
    evidences: ReadonlyMap<string, StoredEvidence>,
  ): OdsEvolutionResponse {
    const { ods_number, score_value, calculated_at, contributions } = score;

    if (score_value === null || calculated_at === null) {
      return {
        ods_number,
        status: OdsEvolutionStatus.NO_DATED_EVIDENCE,
        steps: [],
      };
    }

    const counted = contributions.flatMap(({ evidence }) => {
      const stored = evidences.get(evidence.id);

      return stored ? [stored] : [];
    });
    const { status, steps } = buildOdsEvolution({
      odsNumber: ods_number,
      evidences: counted,
      scoreValue: score_value,
      calculatedAt: new Date(calculated_at),
    });

    if (status === OdsEvolutionStatus.NOT_REPRODUCIBLE) {
      this.logger.error(
        `A evolução de ${cnpj} no ODS ${ods_number} não reproduz o índice ${score_value}.`,
      );
    }

    return {
      ods_number,
      status,
      steps: steps.map((step) => {
        const evidence = evidences.get(step.evidenceId);
        const contribution = contributions.find(
          (item) => item.evidence.id === step.evidenceId,
        );

        return {
          date: step.date.toISOString(),
          score_value: step.scoreValue,
          cause: step.cause,
          evidence_count: step.evidenceCount,
          evidence: {
            id: step.evidenceId,
            category: evidence?.category ?? contribution!.evidence.category,
            source_slug: contribution!.evidence.source_slug,
            source: contribution!.evidence.source,
            summary: evidence?.summary ?? null,
            source_reference: contribution!.evidence.source_reference,
            source_url: contribution!.evidence.source_url,
          },
        };
      }),
    };
  }
}
