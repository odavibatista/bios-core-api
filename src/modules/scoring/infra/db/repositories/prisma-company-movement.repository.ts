import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  CompanyMovementRepository,
  type CompanyMovementsPage,
  type CompanyMovementsWindow,
  type MovementCandidatesPage,
  type ReconstructedMovementToSave,
} from '../../../domain/dtos/repositories/company-movement.repository.js';
import { evidenceFactDate } from '../../../domain/ods-movement-rules.js';

/** Código de erro do Prisma para violação de chave única. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** Quantos identificadores vão em cada `in`: o custo do Prisma cresce mais que o linear (#336). */
const EVIDENCE_CHUNK_SIZE = 100;

type StoredMovement = Prisma.CompanyMovementGetPayload<{
  select: { cnpj: true; moved_at: true; ods_movements: true };
}>;

@Injectable()
export class PrismaCompanyMovementRepository
  extends PrismaRepository
  implements CompanyMovementRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findPage({
    skip,
    take,
    category,
  }: CompanyMovementsWindow): Promise<CompanyMovementsPage> {
    if (category) return this.findCategoryPage({ skip, take, category });

    // Sem filtro, a ordem é a do índice de data e CNPJ (NFDE03).
    const [rows, total] = await Promise.all([
      this.prisma.companyMovement.findMany({
        select: { cnpj: true, moved_at: true, ods_movements: true },
        orderBy: [{ moved_at: 'desc' }, { cnpj: 'asc' }],
        skip,
        take,
      }),
      this.prisma.companyMovement.count(),
    ]);

    return this.toPage(rows, total);
  }

  /** A busca por categoria usa diretamente o índice multikey; `some` no Prisma varre a coleção. */
  private async findCategoryPage({
    skip,
    take,
    category,
  }: Required<CompanyMovementsWindow>): Promise<CompanyMovementsPage> {
    const filter = { 'ods_movements.evidence_category': category };
    const [found, counted] = await Promise.all([
      this.prisma.$runCommandRaw({
        find: 'company_movements',
        filter,
        sort: { moved_at: -1, cnpj: 1 },
        projection: { cnpj: 1, _id: 0 },
        skip,
        limit: take,
      }),
      this.prisma.$runCommandRaw({ count: 'company_movements', query: filter }),
    ]);
    const batch = (found as { cursor?: { firstBatch?: { cnpj?: unknown }[] } })
      .cursor?.firstBatch;
    const total = (counted as { n?: unknown }).n;
    if (!Array.isArray(batch) || typeof total !== 'number') {
      throw new Error(
        'Resposta inválida da consulta de movimentações filtradas',
      );
    }
    const cnpjs = batch.map((item) => {
      if (typeof item.cnpj !== 'string')
        throw new Error('CNPJ inválido na consulta de movimentações');
      return item.cnpj;
    });
    if (cnpjs.length === 0) return { rows: [], total };
    const rows = await this.prisma.companyMovement.findMany({
      where: { cnpj: { in: cnpjs } },
      select: { cnpj: true, moved_at: true, ods_movements: true },
    });
    const byCnpj = new Map(rows.map((row) => [row.cnpj, row]));

    return this.toPage(
      cnpjs.flatMap((cnpj) => {
        const row = byCnpj.get(cnpj);
        return row ? [row] : [];
      }),
      total,
    );
  }

  private toPage(rows: StoredMovement[], total: number): CompanyMovementsPage {
    return {
      rows: rows.map((row) => ({
        cnpj: row.cnpj,
        movedAt: row.moved_at,
        movements: row.ods_movements.map((item) => ({
          odsNumber: item.ods_number,
          direction: item.direction,
          cause: item.cause,
          evidenceCategory: item.evidence_category,
          movedAt: item.moved_at,
        })),
      })),
      total,
    };
  }

  async findCandidates(
    afterCnpj: string | null,
    limit: number,
  ): Promise<MovementCandidatesPage> {
    const profiles = await this.prisma.companyProfile.findMany({
      where: afterCnpj ? { cnpj: { gt: afterCnpj } } : {},
      select: { cnpj: true },
      orderBy: { cnpj: 'asc' },
      take: limit,
    });

    if (!profiles.length) return { candidates: [], nextCursor: null };

    const cnpjs = profiles.map(({ cnpj }) => cnpj);
    const known = await this.prisma.companyMovement.findMany({
      where: { cnpj: { in: cnpjs } },
      select: { cnpj: true },
    });
    const moved = new Set(known.map(({ cnpj }) => cnpj));
    const missing = cnpjs.filter((cnpj) => !moved.has(cnpj));
    const rows = missing.length
      ? await this.prisma.companyOdsScore.findMany({
          where: { cnpj: { in: missing } },
          select: {
            cnpj: true,
            ods_id: true,
            ods_number: true,
            score_value: true,
            contributions: true,
          },
          orderBy: { ods_number: 'asc' },
        })
      : [];
    // Um ODS sem índice não tem o que reconstruir, e `null` e campo ausente são coisas
    // diferentes para o filtro do Prisma no MongoDB: a seleção fica aqui.
    const scored = rows.filter((row) => (row.score_value ?? null) !== null);
    const dates = await this.evidenceDates(
      scored.flatMap((row) =>
        row.contributions.map((item) => item.evidence_id),
      ),
    );
    const candidates = missing.flatMap((cnpj) => {
      const scores = scored
        .filter((row) => row.cnpj === cnpj)
        .map((row) => ({
          odsId: row.ods_id,
          odsNumber: row.ods_number,
          contributions: row.contributions.map((item) => ({
            evidenceId: item.evidence_id,
            category: item.category,
            points: item.points,
            evidenceDate: dates.get(item.evidence_id) ?? null,
          })),
        }));

      return scores.length ? [{ cnpj, scores }] : [];
    });

    return { candidates, nextCursor: cnpjs[cnpjs.length - 1] };
  }

  async createIfMissing(
    cnpj: string,
    movements: readonly ReconstructedMovementToSave[],
  ): Promise<boolean> {
    try {
      await this.prisma.companyMovement.create({
        data: {
          cnpj,
          moved_at: new Date(
            Math.max(...movements.map(({ movedAt }) => movedAt.getTime())),
          ),
          ods_movements: movements.map((movement) => ({
            ods_id: movement.odsId,
            ods_number: movement.odsNumber,
            direction: movement.direction,
            cause: movement.cause,
            evidence_category: movement.evidenceCategory,
            moved_at: movement.movedAt,
          })),
        },
      });

      return true;
    } catch (error) {
      // Um recálculo gravou enquanto a varredura lia: a movimentação dele vale.
      if ((error as { code?: string }).code === UNIQUE_CONSTRAINT_VIOLATION) {
        return false;
      }

      throw error;
    }
  }

  /** A data do fato de cada evidência; fica de fora a que não tem nenhuma. */
  private async evidenceDates(
    ids: readonly string[],
  ): Promise<Map<string, Date>> {
    const unique = [...new Set(ids)];
    const chunks: string[][] = [];

    for (let start = 0; start < unique.length; start += EVIDENCE_CHUNK_SIZE) {
      chunks.push(unique.slice(start, start + EVIDENCE_CHUNK_SIZE));
    }

    const rows = (
      await Promise.all(
        chunks.map((chunk) =>
          this.prisma.evidenceNormalized.findMany({
            where: { id_evidence: { in: chunk } },
            select: { id_evidence: true, published_at: true, details: true },
          }),
        ),
      )
    ).flat();

    return new Map(
      rows.flatMap((row) => {
        const date = evidenceFactDate(row.published_at ?? null, row.details);

        return date ? [[row.id_evidence, date] as const] : [];
      }),
    );
  }
}
