import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { OdsNotAvailableException } from '../../domain/dtos/errors/ods-not-available.errors.js';
import { OdsScoreRepository } from '../../domain/dtos/repositories/ods-score.repository.js';
import { SectorScoreSnapshotRepository } from '../../domain/dtos/repositories/sector-score-snapshot.repository.js';
import type { SectorEvolutionResponse } from '../../domain/dtos/requests/sector-evolution.dto.js';
import { MINIMUM_EVOLUTION_WINDOWS } from '../../domain/sector-evolution.js';

/** Setor (divisão CNAE) e ODS da consulta. */
export interface SectorEvolutionInput {
  cnaeDivision: string;
  odsNumber: number;
}

/**
 * Evolução do índice médio de um ODS num setor (UC10, RF30, #90): as janelas gravadas pelo
 * job dos agregados, da mais antiga à mais recente.
 *
 * Sempre por setor, nunca por empresa (IA05): não há parâmetro nem campo de empresa. Com
 * menos de duas janelas, responde que o histórico é insuficiente (fluxo 2.1), com o que já
 * houver. ODS que o BIOS não calcula responde `422 ODS_NOT_AVAILABLE`, como na pesquisa.
 */
@Injectable()
export class GetSectorEvolutionUseCase extends UseCase<
  SectorEvolutionInput,
  SectorEvolutionResponse
> {
  constructor(
    private readonly scores: OdsScoreRepository,
    private readonly snapshots: SectorScoreSnapshotRepository,
  ) {
    super();
  }

  override async execute({
    cnaeDivision,
    odsNumber,
  }: SectorEvolutionInput): Promise<SectorEvolutionResponse> {
    const active = await this.scores.findActiveOds();
    const ods = active.find(({ number }) => number === odsNumber);

    if (!ods) {
      throw new OdsNotAvailableException(
        odsNumber,
        active.map(({ number }) => number).sort((a, b) => a - b),
      );
    }

    const windows = await this.snapshots.listEvolution(ods.id, cnaeDivision);

    return {
      cnae_division: cnaeDivision,
      ods_number: odsNumber,
      history_status:
        windows.length >= MINIMUM_EVOLUTION_WINDOWS
          ? 'AVAILABLE'
          : 'INSUFFICIENT',
      windows: windows.map((window) => ({
        window_start: window.windowStart.toISOString(),
        window_end: window.windowEnd.toISOString(),
        average_score: window.averageScore,
        average_confidence: window.averageConfidence,
        company_count: window.companyCount,
        scored_company_count: window.scoredCompanyCount,
        rules_version: window.rulesVersion,
      })),
    };
  }
}
