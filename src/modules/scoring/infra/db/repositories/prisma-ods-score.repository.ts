import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  OdsScoreRepository,
  type ActiveOds,
  type OdsScoreToSave,
  type OdsScoreSnapshot,
  type ScoreProfileLocation,
} from '../../../domain/dtos/repositories/ods-score.repository.js';

@Injectable()
export class PrismaOdsScoreRepository
  extends PrismaRepository
  implements OdsScoreRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findActiveOds(): Promise<ActiveOds[]> {
    const rows = await this.prisma.ods.findMany({
      where: { is_active: true },
      select: { id_ods: true, ods_number: true },
      orderBy: { ods_number: 'asc' },
    });
    return rows.map((row) => ({ id: row.id_ods, number: row.ods_number }));
  }

  async findByCnpjAndOdsNumber(
    cnpj: string,
    odsNumber: number,
  ): Promise<OdsScoreSnapshot | null> {
    const row = await this.prisma.companyOdsScore.findFirst({
      where: { cnpj, ods_number: odsNumber },
    });
    if (!row) return null;
    return {
      cnpj: row.cnpj,
      odsNumber: row.ods_number,
      scoreValue: row.score_value,
      confidenceValue: row.confidence_value,
      evidenceCount: row.evidence_count,
      contributions: row.contributions.map((item) => ({
        evidenceId: item.evidence_id,
        category: item.category,
        signal: item.signal,
        weight: item.weight,
        points: item.points,
      })),
      rulesVersion: row.rules_version,
      calculatedAt: row.calculated_at,
    };
  }

  async findProfileLocation(
    cnpj: string,
  ): Promise<ScoreProfileLocation | null> {
    const profile = await this.prisma.companyProfile.findUnique({
      where: { cnpj },
      select: { address: true, main_cnae: true, secondary_cnaes: true },
    });
    if (!profile) return null;
    return {
      uf: profile.address.uf,
      city: profile.address.city,
      cnaeCodes: [
        ...new Set([
          profile.main_cnae.code,
          ...profile.secondary_cnaes.map((cnae) => cnae.code),
        ]),
      ],
    };
  }

  async replaceForCompany(
    cnpj: string,
    scores: readonly OdsScoreToSave[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const score of scores) {
        const fields = {
          ods_number: score.odsNumber,
          score_value: score.scoreValue,
          confidence_value: score.confidenceValue,
          evidence_count: score.evidenceCount,
          contributions: score.contributions.map((item) => ({
            evidence_id: item.evidenceId,
            category: item.category,
            signal: item.signal,
            weight: item.weight,
            points: item.points,
          })),
          rules_version: score.rulesVersion,
          uf: score.location?.uf ?? null,
          city: score.location?.city ?? null,
          cnae_codes: score.location?.cnaeCodes ?? [],
          calculated_at: score.calculatedAt,
        };
        await tx.companyOdsScore.upsert({
          where: { cnpj_ods_id: { cnpj, ods_id: score.odsId } },
          create: { cnpj, ods_id: score.odsId, ...fields },
          update: fields,
        });
      }
      await tx.companyOdsScore.deleteMany({
        where: { cnpj, ods_id: { notIn: scores.map((score) => score.odsId) } },
      });
    });
  }
}
