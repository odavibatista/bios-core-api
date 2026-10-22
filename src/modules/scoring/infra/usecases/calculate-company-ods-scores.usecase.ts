import { Injectable } from '@nestjs/common';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import {
  CalculatedOdsScoreSchema,
  CalculateOdsScoresRequestSchema,
  type CalculatedOdsScore,
} from '../../domain/dtos/requests/calculate-ods-scores.dto.js';
import { OdsScoreRepository } from '../../domain/dtos/repositories/ods-score.repository.js';
import {
  ODS_SCORE_RULES,
  ODS_SCORE_RULES_VERSION,
  scoreOdsEvidences,
} from '../../domain/ods-score-rules.js';

/** UC15/RF10/RF11: recalcula índice e confiança dos ODS ativos. */
@Injectable()
export class CalculateCompanyOdsScoresUseCase extends UseCase<
  string,
  CalculatedOdsScore[]
> {
  constructor(
    private readonly evidences: ListCompanyEvidencesUseCase,
    private readonly scores: OdsScoreRepository,
  ) {
    super();
  }

  override async execute(input: string): Promise<CalculatedOdsScore[]> {
    const { cnpj } = CalculateOdsScoresRequestSchema.parse({ cnpj: input });
    const ods = await this.scores.findActiveOds();
    if (!ods.length) throw new Error('Nenhum ODS ativo para calcular indices.');
    for (const item of ods)
      if (!ODS_SCORE_RULES[item.number])
        throw new Error(`ODS ${item.number} sem regras de pontuacao.`);

    const evidences = await this.evidences.execute(cnpj);
    const location = await this.scores.findProfileLocation(cnpj);
    const calculatedAt = new Date();
    const results = ods.map((item) =>
      CalculatedOdsScoreSchema.parse({
        cnpj,
        odsId: item.id,
        odsNumber: item.number,
        ...scoreOdsEvidences(
          item.number,
          evidences.filter((evidence) => evidence.odsNumber === item.number),
          calculatedAt,
        ),
        rulesVersion: ODS_SCORE_RULES_VERSION,
        calculatedAt,
      }),
    );
    await this.scores.replaceForCompany(
      cnpj,
      results.map((score) => ({ ...score, location })),
    );
    return results;
  }
}
