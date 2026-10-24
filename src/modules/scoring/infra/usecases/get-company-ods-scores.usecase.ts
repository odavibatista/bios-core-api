import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import {
  ScoreExplanationStaleException,
  ScoreNotFoundException,
} from '../../domain/dtos/errors/score-explanation.errors.js';
import { OdsScoreRepository } from '../../domain/dtos/repositories/ods-score.repository.js';
import {
  CompanyOdsScoreSchema,
  type CompanyOdsScore,
} from '../../domain/dtos/requests/company-ods-scores.dto.js';
import type { ScoreExplanationResponse } from '../../domain/dtos/requests/score-explanation.dto.js';
import { GetScoreExplanationUseCase } from './get-score-explanation.usecase.js';

/** O CNPJ já está na raiz do perfil; cada ODS não o repete. */
function withoutCnpj(
  explanation: ScoreExplanationResponse,
): Omit<ScoreExplanationResponse, 'cnpj'> {
  const copy: Partial<ScoreExplanationResponse> = { ...explanation };
  delete copy.cnpj;

  return copy as Omit<ScoreExplanationResponse, 'cnpj'>;
}

/**
 * Índice, confiança e explicação de cada ODS ativo de uma empresa (UC07).
 *
 * Lê os retratos já gravados, sem coletar fontes nem recalcular. Um ODS sem retrato, ou
 * cujo retrato deixou de ser auditável, sai como `PENDING` em vez de derrubar o perfil
 * inteiro: o recálculo (UC15) o repõe. A ordem é a do número do ODS.
 */
@Injectable()
export class GetCompanyOdsScoresUseCase extends UseCase<
  string,
  CompanyOdsScore[]
> {
  constructor(
    private readonly scores: OdsScoreRepository,
    private readonly explanation: GetScoreExplanationUseCase,
  ) {
    super();
  }

  override async execute(cnpj: string): Promise<CompanyOdsScore[]> {
    const activeOds = (await this.scores.findActiveOds()).sort(
      (a, b) => a.number - b.number,
    );

    return Promise.all(
      activeOds.map(({ number }) => this.readOds(cnpj, number)),
    );
  }

  private async readOds(
    cnpj: string,
    odsNumber: number,
  ): Promise<CompanyOdsScore> {
    try {
      const snapshot = withoutCnpj(
        await this.explanation.execute({ cnpj, odsNumber }),
      );

      return CompanyOdsScoreSchema.parse({
        ...snapshot,
        calculation_status: 'CALCULATED',
      });
    } catch (error) {
      if (
        error instanceof ScoreNotFoundException ||
        error instanceof ScoreExplanationStaleException
      ) {
        return CompanyOdsScoreSchema.parse({
          ods_number: odsNumber,
          calculation_status: 'PENDING',
          index_status: 'UNAVAILABLE',
          score_value: null,
          confidence_value: null,
          evidence_count: null,
          coverage_status: null,
          sources_without_records: [],
          rules_version: null,
          calculated_at: null,
          contributions: [],
        });
      }

      throw error;
    }
  }
}
