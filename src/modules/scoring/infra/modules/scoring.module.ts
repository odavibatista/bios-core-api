import { Module } from '@nestjs/common';
import { EvidencesModule } from '@modules/evidences/infra/modules/evidences.module.js';
import { OdsScoreRepository } from '../../domain/dtos/repositories/ods-score.repository.js';
import { PrismaOdsScoreRepository } from '../db/repositories/prisma-ods-score.repository.js';
import { CalculateCompanyOdsScoresUseCase } from '../usecases/calculate-company-ods-scores.usecase.js';
import { RecalculateStaleScoresUseCase } from '../usecases/recalculate-stale-scores.usecase.js';
import { RequestScoreRecalculationBatchUseCase } from '../usecases/request-score-recalculation-batch.usecase.js';
import { RequestScoreRecalculationUseCase } from '../usecases/request-score-recalculation.usecase.js';
import { ListOdsScoreSummariesUseCase } from '../usecases/list-ods-score-summaries.usecase.js';
import { GetCompanyOdsScoresUseCase } from '../usecases/get-company-ods-scores.usecase.js';
import { GetScoreExplanationUseCase } from '../usecases/get-score-explanation.usecase.js';
import { OdsScoringProcessor } from '../queue/ods-scoring.processor.js';
import { ListOdsUseCase } from '../usecases/list-ods.usecase.js';
import { EnsureActiveOdsUseCase } from '../usecases/ensure-active-ods.usecase.js';
import { OdsController } from '../../http/controllers/ods.controller.js';
import { ScoreExplanationController } from '../../http/controllers/score-explanation.controller.js';

/**
 * ODS de referência, índices de aderência e confiança por empresa e ODS,
 * explicação do score e agregados setoriais (UC07, UC10, UC15).
 *
 * Entidades (schemas Prisma em `../../entity`): `Ods`, `CompanyOdsScore`, `SectorScoreSnapshot`.
 */
@Module({
  imports: [EvidencesModule],
  controllers: [ScoreExplanationController, OdsController],
  providers: [
    { provide: OdsScoreRepository, useClass: PrismaOdsScoreRepository },
    CalculateCompanyOdsScoresUseCase,
    GetScoreExplanationUseCase,
    GetCompanyOdsScoresUseCase,
    ListOdsScoreSummariesUseCase,
    ListOdsUseCase,
    EnsureActiveOdsUseCase,

    /* Recálculo por fila (#80) */
    RequestScoreRecalculationUseCase,
    RequestScoreRecalculationBatchUseCase,
    RecalculateStaleScoresUseCase,
    OdsScoringProcessor,
  ],
  exports: [
    CalculateCompanyOdsScoresUseCase,
    GetCompanyOdsScoresUseCase,
    ListOdsScoreSummariesUseCase,
    EnsureActiveOdsUseCase,
    RequestScoreRecalculationUseCase,
    RequestScoreRecalculationBatchUseCase,
  ],
})
export class ScoringModule {}
