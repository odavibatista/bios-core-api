import { Injectable } from '@nestjs/common';
import { EvidenceState, Prisma } from '@prisma/client';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  EvidenceRepository,
  type EvidenceToSave,
  type StoredEvidence,
} from '../../../domain/dtos/repositories/evidence.repository.js';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const WRITE_CONFLICT = 'P2034';

function scopeKey(sourceId: string, cnpj: string): string {
  return `${sourceId}:${cnpj}`;
}

/**
 * Evidências normalizadas no MongoDB.
 *
 * O relógio por fonte/CNPJ serializa as transações de retrato e carga. Uma
 * transação que perde uma disputa de escrita é repetida e reavalia a data;
 * o índice único da chave preserva a identidade da evidência.
 */
@Injectable()
export class PrismaEvidenceRepository
  extends PrismaRepository
  implements EvidenceRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async save(evidence: EvidenceToSave): Promise<void> {
    // Campo ausente vira `null` explícito: omitir deixaria, na atualização, o
    // valor da coleta anterior (um resumo ou um link que a fonte retirou).
    const data = {
      cnpj: evidence.cnpj,
      data_source_id: evidence.dataSourceId,
      ods_id: evidence.odsId,
      category: evidence.category,
      state: evidence.state,
      signal: evidence.signal,
      summary: evidence.summary,
      source_reference: evidence.sourceReference,
      source_url: evidence.sourceUrl,
      details: evidence.details,
      published_at: evidence.publishedAt,
      collected_at: evidence.collectedAt,
      valid_until: evidence.validUntil,
      evidence_raw_id: evidence.rawEvidenceId,
    } satisfies Prisma.EvidenceNormalizedUncheckedUpdateInput;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const [companyClock, fullDumpClock] = await Promise.all([
            tx.evidenceCollectionClock.findUnique({
              where: {
                scope_key: scopeKey(evidence.dataSourceId, evidence.cnpj),
              },
            }),
            tx.evidenceCollectionClock.findUnique({
              where: { scope_key: scopeKey(evidence.dataSourceId, '*') },
            }),
          ]);
          if (
            [companyClock, fullDumpClock].some(
              (clock) => clock && clock.collected_at > evidence.collectedAt,
            )
          )
            return;
          await tx.evidenceCollectionClock.upsert({
            where: {
              scope_key: scopeKey(evidence.dataSourceId, evidence.cnpj),
            },
            create: {
              scope_key: scopeKey(evidence.dataSourceId, evidence.cnpj),
              collected_at: evidence.collectedAt,
            },
            update: { collected_at: evidence.collectedAt },
          });
          const updated = await tx.evidenceNormalized.updateMany({
            where: {
              evidence_key: evidence.key,
              collected_at: { lte: evidence.collectedAt },
            },
            data,
          });
          if (updated.count) return;
          const existing = await tx.evidenceNormalized.findUnique({
            where: { evidence_key: evidence.key },
            select: { id_evidence: true },
          });
          if (existing) return;
          await tx.evidenceNormalized.create({
            data: { evidence_key: evidence.key, ...data },
          });
        });
        return;
      } catch (error) {
        if (
          attempt === 11 ||
          (!isUniqueViolation(error) && !isWriteConflict(error))
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
      }
    }
  }

  async replaceSnapshot(
    cnpj: string,
    dataSourceId: string,
    collectedAt: Date,
    evidences: readonly EvidenceToSave[],
    ifUnanswered = false,
  ): Promise<{ saved: number; removed: number }> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const [companyClock, fullDumpClock] = await Promise.all([
            tx.evidenceCollectionClock.findUnique({
              where: { scope_key: scopeKey(dataSourceId, cnpj) },
            }),
            tx.evidenceCollectionClock.findUnique({
              where: { scope_key: scopeKey(dataSourceId, '*') },
            }),
          ]);
          if (
            [companyClock, fullDumpClock].some(
              (clock) => clock && clock.collected_at > collectedAt,
            )
          )
            return { saved: 0, removed: 0 };
          if (ifUnanswered) {
            const answered = await tx.evidenceNormalized.findFirst({
              where: {
                cnpj,
                data_source_id: dataSourceId,
                state: {
                  in: [EvidenceState.CONFIRMED, EvidenceState.NOT_FOUND],
                },
              },
              select: { id_evidence: true },
            });
            if (answered) return { saved: 0, removed: 0 };
          }

          // Toda publicação da empresa escreve o mesmo relógio. Transações
          // concorrentes disputam esse documento e a perdedora é repetida.
          // UNKNOWN é apenas um marcador de tentativa. Ele não avança a
          // versão do dado, pois um cache válido coletado antes ainda pode
          // responder depois dessa tentativa.
          if (!ifUnanswered)
            await tx.evidenceCollectionClock.upsert({
              where: { scope_key: scopeKey(dataSourceId, cnpj) },
              create: {
                scope_key: scopeKey(dataSourceId, cnpj),
                collected_at: collectedAt,
              },
              update: { collected_at: collectedAt },
            });
          for (const evidence of evidences) {
            const data = {
              cnpj: evidence.cnpj,
              data_source_id: evidence.dataSourceId,
              ods_id: evidence.odsId,
              category: evidence.category,
              state: evidence.state,
              signal: evidence.signal,
              summary: evidence.summary,
              source_reference: evidence.sourceReference,
              source_url: evidence.sourceUrl,
              details: evidence.details,
              published_at: evidence.publishedAt,
              collected_at: evidence.collectedAt,
              valid_until: evidence.validUntil,
              evidence_raw_id: evidence.rawEvidenceId,
            } satisfies Prisma.EvidenceNormalizedUncheckedUpdateInput;
            await tx.evidenceNormalized.upsert({
              where: { evidence_key: evidence.key },
              create: { evidence_key: evidence.key, ...data },
              update: data,
            });
          }
          const removed = await tx.evidenceNormalized.deleteMany({
            where: {
              cnpj,
              data_source_id: dataSourceId,
              evidence_key: { notIn: evidences.map(({ key }) => key) },
              OR: ifUnanswered
                ? [{ collected_at: { lte: collectedAt } }]
                : [
                    { collected_at: { lte: collectedAt } },
                    { state: EvidenceState.UNKNOWN },
                  ],
            },
          });
          return { saved: evidences.length, removed: removed.count };
        });
      } catch (error) {
        if (
          attempt === 11 ||
          (!isUniqueViolation(error) && !isWriteConflict(error))
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
      }
    }
    throw new Error('Não foi possível publicar o retrato da fonte.');
  }

  async findCnpjsNotCollectedSince(
    dataSourceId: string,
    before: Date,
  ): Promise<string[]> {
    const rows = await this.prisma.evidenceNormalized.findMany({
      where: { data_source_id: dataSourceId, collected_at: { lt: before } },
      select: { cnpj: true },
      distinct: ['cnpj'],
    });

    return rows.map(({ cnpj }) => cnpj);
  }

  async deleteNotCollectedSince(
    dataSourceId: string,
    before: Date,
  ): Promise<number> {
    await this.advanceFullDumpClock(dataSourceId, before);
    const { count } = await this.prisma.evidenceNormalized.deleteMany({
      where: { data_source_id: dataSourceId, collected_at: { lt: before } },
    });

    return count;
  }

  async renewValidity(
    dataSourceId: string,
    collectedAt: Date,
    validUntil: Date,
  ): Promise<number> {
    await this.advanceFullDumpClock(dataSourceId, collectedAt);
    const { count } = await this.prisma.evidenceNormalized.updateMany({
      where: {
        data_source_id: dataSourceId,
        state: { in: [EvidenceState.CONFIRMED, EvidenceState.NOT_FOUND] },
        collected_at: { lte: collectedAt },
      },
      data: { collected_at: collectedAt, valid_until: validUntil },
    });

    return count;
  }

  private async advanceFullDumpClock(sourceId: string, collectedAt: Date) {
    const key = scopeKey(sourceId, '*');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const updated = await this.prisma.evidenceCollectionClock.updateMany({
        where: { scope_key: key, collected_at: { lt: collectedAt } },
        data: { collected_at: collectedAt },
      });
      if (updated.count) return;
      const current = await this.prisma.evidenceCollectionClock.findUnique({
        where: { scope_key: key },
      });
      if (current) return;
      try {
        await this.prisma.evidenceCollectionClock.create({
          data: { scope_key: key, collected_at: collectedAt },
        });
        return;
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 3) throw error;
      }
    }
  }

  async hasAnsweredCollection(
    cnpj: string,
    dataSourceId: string,
  ): Promise<boolean> {
    const answered = await this.prisma.evidenceNormalized.findFirst({
      where: {
        cnpj,
        data_source_id: dataSourceId,
        state: { in: [EvidenceState.CONFIRMED, EvidenceState.NOT_FOUND] },
      },
      select: { id_evidence: true },
    });

    return answered !== null;
  }

  async findByCnpj(cnpj: string): Promise<StoredEvidence[]> {
    const evidences = await this.prisma.evidenceNormalized.findMany({
      where: { cnpj },
      include: {
        data_source: { select: { slug: true, name: true } },
        ods: { select: { ods_number: true } },
      },
      orderBy: [{ collected_at: 'desc' }, { evidence_key: 'asc' }],
    });

    return evidences.map((evidence) => ({
      id: evidence.id_evidence,
      key: evidence.evidence_key,
      cnpj: evidence.cnpj,
      sourceSlug: evidence.data_source.slug,
      sourceName: evidence.data_source.name,
      category: evidence.category,
      odsNumber: evidence.ods.ods_number,
      state: evidence.state,
      signal: evidence.signal,
      summary: evidence.summary ?? null,
      sourceReference: evidence.source_reference ?? null,
      sourceUrl: evidence.source_url ?? null,
      details: evidence.details ?? null,
      publishedAt: evidence.published_at ?? null,
      collectedAt: evidence.collected_at,
      validUntil: evidence.valid_until,
      rawEvidenceId: evidence.evidence_raw_id ?? null,
    }));
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}

function isWriteConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === WRITE_CONFLICT
  );
}
