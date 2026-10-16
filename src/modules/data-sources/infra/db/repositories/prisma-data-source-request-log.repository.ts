import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import type { DataSourceRequestLogEntry } from '../../../domain/dtos/providers/data-source-request.dto.js';
import { DataSourceRequestLogRepository } from '../../../domain/dtos/repositories/data-source-request-log.repository.js';

/**
 * Log de requisições às fontes externas no MongoDB.
 *
 * Os campos opcionais ausentes não são gravados: no MongoDB o campo omitido
 * fica fora do documento, e é assim que o resto do sistema os lê.
 */
@Injectable()
export class PrismaDataSourceRequestLogRepository
  extends PrismaRepository
  implements DataSourceRequestLogRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async record(entry: DataSourceRequestLogEntry): Promise<void> {
    await this.prisma.dataSourceRequestLog.create({
      data: {
        data_source_id: entry.dataSourceId,
        ingestion_run_id: entry.ingestionRunId,
        cnpj: entry.cnpj,
        trigger: entry.trigger,
        outcome: entry.outcome,
        http_status: entry.httpStatus,
        duration_ms: entry.durationMs,
        error_message: entry.errorMessage,
      },
    });
  }
}
