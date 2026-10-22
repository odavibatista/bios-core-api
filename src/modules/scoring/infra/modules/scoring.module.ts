import { Module } from '@nestjs/common';
import { EvidencesModule } from '@modules/evidences/infra/modules/evidences.module.js';
import { OdsScoreRepository } from '../../domain/dtos/repositories/ods-score.repository.js';
import { PrismaOdsScoreRepository } from '../db/repositories/prisma-ods-score.repository.js';
import { CalculateCompanyOdsScoresUseCase } from '../usecases/calculate-company-ods-scores.usecase.js';
import { GetScoreExplanationUseCase } from '../usecases/get-score-explanation.usecase.js';
import { ScoreExplanationController } from '../../http/controllers/score-explanation.controller.js';

/**
 * ODS de referência, índices de aderência e confiança por empresa e ODS,
 * explicação do score e agregados setoriais (UC07, UC10, UC15).
 *
 * Entidades (schemas Prisma em `../../entity`): `Ods`, `CompanyOdsScore`, `SectorScoreSnapshot`.
 */
@Module({
  imports: [EvidencesModule],
  controllers: [ScoreExplanationController],
  providers: [
    { provide: OdsScoreRepository, useClass: PrismaOdsScoreRepository },
    CalculateCompanyOdsScoresUseCase,
    GetScoreExplanationUseCase,
  ],
  exports: [CalculateCompanyOdsScoresUseCase],
})
export class ScoringModule {}
