import { Injectable } from '@nestjs/common';
import {
  type IngestionRun,
  IngestionRunStatus,
  IngestionRunType,
} from '@prisma/client';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  type IngestionRunOutcome,
  type IngestionRunRecord,
  IngestionRunRepository,
  type OpenScheduledRunInput,
} from '../../../domain/dtos/repositories/ingestion-run.repository.js';

/**
 * Execuções de ingestão no MongoDB.
 *
 * `job_id` não é único no schema (a execução avulsa e a agendada vêm de jobs
 * diferentes), então a execução de um job é buscada pelo par fonte + job.
 */
@Injectable()
export class PrismaIngestionRunRepository
  extends PrismaRepository
  implements IngestionRunRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async openScheduled({
    dataSourceId,
    jobId,
    startedAt,
  }: OpenScheduledRunInput): Promise<IngestionRunRecord> {
    const existing = await this.prisma.ingestionRun.findFirst({
      where: {
        data_source_id: dataSourceId,
        job_id: jobId,
        run_type: IngestionRunType.SCHEDULED,
      },
    });

    if (existing) {
      // `null` explícito: omitir deixaria o erro e o término da tentativa anterior.
      const reopened = await this.prisma.ingestionRun.update({
        where: { id_ingestion_run: existing.id_ingestion_run },
        data: {
          status: IngestionRunStatus.RUNNING,
          started_at: startedAt,
          finished_at: null,
          error_message: null,
        },
      });

      return toRecord(reopened);
    }

    const created = await this.prisma.ingestionRun.create({
      data: {
        data_source_id: dataSourceId,
        run_type: IngestionRunType.SCHEDULED,
        job_id: jobId,
        status: IngestionRunStatus.RUNNING,
        started_at: startedAt,
      },
    });

    return toRecord(created);
  }

  async findByJob(
    dataSourceId: string,
    jobId: string,
  ): Promise<IngestionRunRecord | null> {
    const run = await this.prisma.ingestionRun.findFirst({
      where: {
        data_source_id: dataSourceId,
        job_id: jobId,
        run_type: IngestionRunType.SCHEDULED,
      },
    });

    return run ? toRecord(run) : null;
  }

  async finish(id: string, outcome: IngestionRunOutcome): Promise<void> {
    await this.prisma.ingestionRun.update({
      where: { id_ingestion_run: id },
      data: {
        status: outcome.status,
        dump_checksum: outcome.dumpChecksum ?? null,
        records_read: outcome.recordsRead,
        records_upserted: outcome.recordsUpserted,
        records_discarded: outcome.recordsDiscarded,
        error_message: outcome.errorMessage ?? null,
        finished_at: outcome.finishedAt,
      },
    });
  }

  async findLastSucceeded(
    dataSourceId: string,
  ): Promise<IngestionRunRecord | null> {
    const run = await this.prisma.ingestionRun.findFirst({
      where: {
        data_source_id: dataSourceId,
        status: IngestionRunStatus.SUCCEEDED,
      },
      orderBy: { finished_at: 'desc' },
    });

    return run ? toRecord(run) : null;
  }
}

function toRecord(run: IngestionRun): IngestionRunRecord {
  return {
    id: run.id_ingestion_run,
    dataSourceId: run.data_source_id,
    status: run.status,
    dumpChecksum: run.dump_checksum ?? null,
    startedAt: run.started_at ?? null,
    finishedAt: run.finished_at ?? null,
  };
}
