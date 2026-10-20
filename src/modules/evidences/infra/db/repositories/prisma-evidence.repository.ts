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

/**
 * Evidências normalizadas no MongoDB.
 *
 * A gravação é um `upsert` pela `evidence_key` (índice único). O MongoDB não
 * tem upsert nativo no Prisma, então duas gravações simultâneas da mesma chave
 * podem disputar a criação: quem perde recebe a violação do índice único e
 * repete uma vez, agora como atualização.
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

    const write = () =>
      this.prisma.evidenceNormalized.upsert({
        where: { evidence_key: evidence.key },
        create: { evidence_key: evidence.key, ...data },
        update: data,
      });

    try {
      await write();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      await write();
    }
  }

  async deleteOthers(
    cnpj: string,
    dataSourceId: string,
    keepKeys: readonly string[],
  ): Promise<number> {
    const { count } = await this.prisma.evidenceNormalized.deleteMany({
      where: {
        cnpj,
        data_source_id: dataSourceId,
        evidence_key: { notIn: [...keepKeys] },
      },
    });

    return count;
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
        data_source: { select: { slug: true } },
        ods: { select: { ods_number: true } },
      },
      orderBy: [{ collected_at: 'desc' }, { evidence_key: 'asc' }],
    });

    return evidences.map((evidence) => ({
      id: evidence.id_evidence,
      key: evidence.evidence_key,
      cnpj: evidence.cnpj,
      sourceSlug: evidence.data_source.slug,
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
