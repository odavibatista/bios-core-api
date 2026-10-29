import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '@shared/config/environment.config.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { SectorScoreSnapshotRepository } from '../../domain/dtos/repositories/sector-score-snapshot.repository.js';
import type { AggregateSectorScoresJobResult } from '../../domain/ods-scoring-job.dto.js';
import { ODS_SCORE_RULES_VERSION } from '../../domain/ods-score-rules.js';
import {
  monthlyWindow,
  withMinimumSample,
} from '../../domain/sector-evolution.js';

/**
 * Grava os agregados setoriais do mês corrente (RF30, UC10, IA05, #89): por ODS e divisão
 * CNAE, o índice médio, a confiança média e as contagens, a partir dos índices atuais.
 *
 *  - Só os índices da versão de regras vigente entram: médias de versões diferentes não se
 *    comparam (a varredura de regras roda antes, e recalcula quem ficou para trás).
 *  - Setor com menos empresas que `SECTOR_SNAPSHOT_MIN_COMPANIES` tem as médias omitidas.
 *  - Nada por empresa é gravado: a série histórica é só dos setores.
 *
 * Idempotente na janela: reexecutar no mesmo mês sobrescreve o retrato dele.
 */
@Injectable()
export class AggregateSectorScoresUseCase extends UseCase<
  Date,
  AggregateSectorScoresJobResult
> {
  private readonly minimumCompanies: number;

  constructor(
    private readonly snapshots: SectorScoreSnapshotRepository,
    config: ConfigService<Environment, true>,
  ) {
    super();
    this.minimumCompanies = config.get('SECTOR_SNAPSHOT_MIN_COMPANIES', {
      infer: true,
    });
  }

  override async execute(
    now: Date = new Date(),
  ): Promise<AggregateSectorScoresJobResult> {
    const window = monthlyWindow(now);
    const aggregates = (
      await this.snapshots.aggregateCurrentScores(ODS_SCORE_RULES_VERSION)
    ).map((aggregate) => ({
      ...aggregate,
      ...withMinimumSample(aggregate, this.minimumCompanies),
    }));

    await this.snapshots.replaceWindow(
      window,
      aggregates,
      ODS_SCORE_RULES_VERSION,
    );

    return {
      windowStart: window.start.toISOString(),
      sectors: aggregates.length,
    };
  }
}
