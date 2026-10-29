import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { z } from 'zod';
import {
  type SectorAggregate,
  SectorScoreSnapshotRepository,
  type SectorScoreSnapshot,
} from '../../../domain/dtos/repositories/sector-score-snapshot.repository.js';
import type { SectorWindow } from '../../../domain/sector-evolution.js';

/** Uma linha do `$group` da agregação, como o MongoDB a devolve. */
const AggregateRowSchema = z.object({
  _id: z.object({
    ods_id: z.object({ $oid: z.string() }),
    division: z.string(),
  }),
  company_count: z.number(),
  scored_company_count: z.number(),
  average_score: z.number().nullable(),
  average_confidence: z.number().nullable(),
});

/**
 * Agregados setoriais no MongoDB.
 *
 * A agregação parte de `company_ods_scores` e lê o setor no perfil (`$lookup` pelo CNPJ,
 * índice único): o CNAE principal é o do cadastro, e não uma posição em `cnae_codes`. As
 * médias ignoram o índice nulo (`$avg` só soma números).
 */
@Injectable()
export class PrismaSectorScoreSnapshotRepository
  extends PrismaRepository
  implements SectorScoreSnapshotRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async aggregateCurrentScores(
    rulesVersion: string,
  ): Promise<SectorAggregate[]> {
    const raw = await this.prisma.companyOdsScore.aggregateRaw({
      pipeline: [
        { $match: { rules_version: rulesVersion } },
        {
          $lookup: {
            from: 'company_profile',
            localField: 'cnpj',
            foreignField: 'cnpj',
            as: 'profile',
            pipeline: [{ $project: { _id: 0, code: '$main_cnae.code' } }],
          },
        },
        { $unwind: '$profile' },
        {
          $group: {
            _id: {
              ods_id: '$ods_id',
              division: { $substrBytes: ['$profile.code', 0, 2] },
            },
            company_count: { $sum: 1 },
            scored_company_count: {
              $sum: { $cond: [{ $isNumber: '$score_value' }, 1, 0] },
            },
            average_score: { $avg: '$score_value' },
            average_confidence: { $avg: '$confidence_value' },
          },
        },
      ] as Prisma.InputJsonValue[],
    });

    return z
      .array(AggregateRowSchema)
      .parse(raw)
      .map((row) => ({
        odsId: row._id.ods_id.$oid,
        cnaeDivision: row._id.division,
        companyCount: row.company_count,
        scoredCompanyCount: row.scored_company_count,
        averageScore: row.average_score,
        averageConfidence: row.average_confidence,
      }));
  }

  async replaceWindow(
    window: SectorWindow,
    aggregates: readonly SectorAggregate[],
    rulesVersion: string,
  ): Promise<void> {
    for (const aggregate of aggregates) {
      const values = {
        window_end: window.end,
        average_score: aggregate.averageScore,
        average_confidence: aggregate.averageConfidence,
        company_count: aggregate.companyCount,
        scored_company_count: aggregate.scoredCompanyCount,
        rules_version: rulesVersion,
      };

      await this.prisma.sectorScoreSnapshot.upsert({
        where: {
          ods_id_cnae_division_window_start: {
            ods_id: aggregate.odsId,
            cnae_division: aggregate.cnaeDivision,
            window_start: window.start,
          },
        },
        create: {
          ods_id: aggregate.odsId,
          cnae_division: aggregate.cnaeDivision,
          window_start: window.start,
          ...values,
        },
        update: values,
      });
    }

    const kept = new Set(
      aggregates.map(({ odsId, cnaeDivision }) => `${odsId}:${cnaeDivision}`),
    );
    const existing = await this.prisma.sectorScoreSnapshot.findMany({
      where: { window_start: window.start },
      select: {
        id_sector_score_snapshot: true,
        ods_id: true,
        cnae_division: true,
      },
    });
    const gone = existing
      .filter(
        ({ ods_id, cnae_division }) => !kept.has(`${ods_id}:${cnae_division}`),
      )
      .map(({ id_sector_score_snapshot }) => id_sector_score_snapshot);

    if (gone.length > 0) {
      await this.prisma.sectorScoreSnapshot.deleteMany({
        where: { id_sector_score_snapshot: { in: gone } },
      });
    }
  }

  async listEvolution(
    odsId: string,
    cnaeDivision: string,
  ): Promise<SectorScoreSnapshot[]> {
    const rows = await this.prisma.sectorScoreSnapshot.findMany({
      where: { ods_id: odsId, cnae_division: cnaeDivision },
      orderBy: { window_start: 'asc' },
    });

    return rows.map((row) => ({
      windowStart: row.window_start,
      windowEnd: row.window_end,
      averageScore: row.average_score ?? null,
      averageConfidence: row.average_confidence ?? null,
      companyCount: row.company_count,
      scoredCompanyCount: row.scored_company_count,
      rulesVersion: row.rules_version,
    }));
  }

  async listDivisions(): Promise<string[]> {
    const rows = await this.prisma.sectorScoreSnapshot.findMany({
      distinct: ['cnae_division'],
      select: { cnae_division: true },
      orderBy: { cnae_division: 'asc' },
    });

    return rows.map(({ cnae_division }) => cnae_division);
  }
}
