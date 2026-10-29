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
import { SectorsController } from '../../http/controllers/sectors.controller.js';
import { SectorScoreSnapshotRepository } from '../../domain/dtos/repositories/sector-score-snapshot.repository.js';
import { PrismaSectorScoreSnapshotRepository } from '../db/repositories/prisma-sector-score-snapshot.repository.js';
import { AggregateSectorScoresUseCase } from '../usecases/aggregate-sector-scores.usecase.js';
import { GetSectorEvolutionUseCase } from '../usecases/get-sector-evolution.usecase.js';
import { ListSectorsUseCase } from '../usecases/list-sectors.usecase.js';

/**
 * ODS de referência, índices de aderência e confiança por empresa e ODS,
 * explicação do score e agregados setoriais (UC07, UC10, UC15).
 *
 * Entidades (schemas Prisma em `../../entity`): `Ods`, `CompanyOdsScore`, `SectorScoreSnapshot`.
 */
@Module({
  imports: [EvidencesModule],
  controllers: [ScoreExplanationController, OdsController, SectorsController],
  providers: [
    { provide: OdsScoreRepository, useClass: PrismaOdsScoreRepository },
    {
      provide: SectorScoreSnapshotRepository,
      useClass: PrismaSectorScoreSnapshotRepository,
    },
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

    /* Evolução setorial (#89, #90) */
    AggregateSectorScoresUseCase,
    GetSectorEvolutionUseCase,
    ListSectorsUseCase,
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
