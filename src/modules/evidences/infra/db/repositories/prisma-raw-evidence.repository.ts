import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  RawEvidenceRepository,
  type RawEvidenceToSave,
} from '../../../domain/dtos/repositories/raw-evidence.repository.js';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Camada bruta de evidências no MongoDB.
 *
 * O índice único `(fonte, hash do conteúdo)` é o que impede o mesmo registro de
 * ser gravado duas vezes. A gravação é um `upsert` que, se o registro já existe,
 * **não altera nada**: a data e a execução da primeira coleta ficam. Como no
 * MongoDB o `upsert` do Prisma não é atômico, duas gravações simultâneas do
 * mesmo registro podem disputar a criação; quem perde repete uma vez, e a
 * repetição encontra o registro.
 */
@Injectable()
export class PrismaRawEvidenceRepository
  extends PrismaRepository
  implements RawEvidenceRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async save(raw: RawEvidenceToSave): Promise<string> {
    const write = () =>
      this.prisma.evidenceRaw.upsert({
        where: {
          data_source_id_payload_hash: {
            data_source_id: raw.dataSourceId,
            payload_hash: raw.payloadHash,
          },
        },
        create: {
          data_source_id: raw.dataSourceId,
          ingestion_run_id: raw.ingestionRunId,
          cnpj: raw.cnpj,
          external_reference: raw.externalReference,
          payload: raw.payload,
          payload_hash: raw.payloadHash,
          collected_at: raw.collectedAt,
        },
        update: {},
        select: { id_evidence_raw: true },
      });

    try {
      return (await write()).id_evidence_raw;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      return (await write()).id_evidence_raw;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}
