import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  OdsScoreRepository,
  type ActiveOds,
  type OdsCatalogEntry,
  type OdsScoreToSave,
  type OdsScoreSnapshot,
  type OdsScoreSummary,
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

  async findOdsCatalog(): Promise<OdsCatalogEntry[]> {
    const rows = await this.prisma.ods.findMany({
      where: { is_active: true },
      select: {
        id_ods: true,
        ods_number: true,
        title: true,
        description: true,
      },
      orderBy: { ods_number: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id_ods,
      number: row.ods_number,
      title: row.title,
      description: row.description,
    }));
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
        weightReason: item.weight_reason as
          'CGU_SANCTION_EXPIRED' | 'IBAMA_EMBARGO_LIFTED' | null,
        points: item.points,
      })),
      coverageStatus: row.coverage_status as OdsScoreSnapshot['coverageStatus'],
      sourcesWithoutRecords: row.sources_without_records,
      rulesVersion: row.rules_version,
      calculatedAt: row.calculated_at,
    };
  }

  async findSummariesByCnpjs(
    cnpjs: readonly string[],
  ): Promise<OdsScoreSummary[]> {
    if (cnpjs.length === 0) return [];

    const rows = await this.prisma.companyOdsScore.findMany({
      where: { cnpj: { in: [...cnpjs] } },
      select: {
        cnpj: true,
        ods_number: true,
        score_value: true,
        confidence_value: true,
      },
    });

    return rows.map((row) => ({
      cnpj: row.cnpj,
      odsNumber: row.ods_number,
      scoreValue: row.score_value ?? null,
      confidenceValue: row.confidence_value,
    }));
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
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Todos os índices de uma execução levam o mesmo instante de leitura. Se já há um
      // mais novo, outro recálculo leu depois e terminou antes: este não pode regredi-lo.
      const readAt = scores.reduce(
        (latest, { calculatedAt }) =>
          calculatedAt > latest ? calculatedAt : latest,
        new Date(0),
      );
      const newer = await tx.companyOdsScore.findFirst({
        where: { cnpj, calculated_at: { gt: readAt } },
        select: { id_company_ods_score: true },
      });

      if (newer) return false;

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
            weight_reason: item.weightReason,
            points: item.points,
          })),
          coverage_status: score.coverageStatus,
          sources_without_records: score.sourcesWithoutRecords,
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

      return true;
    });
  }

  async findCnpjsWithOtherRulesVersion(
    rulesVersion: string,
    afterCnpj: string | null,
    limit: number,
  ): Promise<string[]> {
    // Um documento por empresa e ODS: lê mais linhas que `limit` para fechar a página com
    // empresas distintas. O CNPJ é o cursor, então o que sobrar vem na página seguinte.
    const rows = await this.prisma.companyOdsScore.findMany({
      where: {
        rules_version: { not: rulesVersion },
        ...(afterCnpj ? { cnpj: { gt: afterCnpj } } : {}),
      },
      select: { cnpj: true },
      orderBy: { cnpj: 'asc' },
      take: limit * 4,
    });

    return [...new Set(rows.map(({ cnpj }) => cnpj))].slice(0, limit);
  }
}
