import { RequestTrigger } from '@prisma/client';
import { GetCguCompanyEvidencesUseCase } from '@modules/cgu/infra/usecases/get-cgu-company-evidences.usecase.js';
import {
  CguJobSchema,
  FETCH_CGU_EVIDENCES_JOB,
} from '../../domain/cgu-job.dto.js';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { FailIngestionRunUseCase } from '@modules/data-sources/infra/usecases/ingestion/fail-ingestion-run.usecase.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { IbamaSourceDisabledError } from '@modules/ibama/domain/dtos/errors/ibama-ingestion.errors.js';
import {
  IbamaIngestionJobPayloadSchema,
  type IbamaIngestionJobResult,
  INGEST_IBAMA_DUMPS_JOB,
} from '@modules/ibama/domain/dtos/providers/ibama-ingestion-job.dto.js';
import {
  IbamaCompanyJobPayloadSchema,
  type IbamaCompanyJobResult,
  INGEST_IBAMA_COMPANY_JOB,
} from '@modules/ibama/domain/dtos/providers/ibama-company-job.dto.js';
import { IngestIbamaCompanyUseCase } from '@modules/ibama/infra/usecases/ingest-ibama-company.usecase.js';
import { IngestIbamaDumpsUseCase } from '@modules/ibama/infra/usecases/ingest-ibama-dumps.usecase.js';
import { IBAMA_SLUG } from '@modules/ibama/infra/providers/ibama.data-source.js';

/** Unico consumidor ambiental: despacha IBAMA e CGU pelo nome do job.
 * GHG permanece em sua fila exclusiva. Falhas CGU nao alteram runs IBAMA.
 */
@Processor(QueueName.ENVIRONMENTAL_EVIDENCES, { concurrency: 3 })
export class EnvironmentalEvidencesProcessor extends WorkerHost {
  private readonly logger = new Logger(EnvironmentalEvidencesProcessor.name);

  constructor(
    private readonly ingestIbamaDumps: IngestIbamaDumpsUseCase,
    private readonly ingestIbamaCompany: IngestIbamaCompanyUseCase,
    private readonly failIngestionRun: FailIngestionRunUseCase,
    private readonly cgu: GetCguCompanyEvidencesUseCase,
  ) {
    super();
  }

  async process(
    job: Job<unknown>,
  ): Promise<
    IbamaIngestionJobResult | IbamaCompanyJobResult | { status: 'COLLECTED' }
  > {
    if (job.name === FETCH_CGU_EVIDENCES_JOB) {
      const payload = CguJobSchema.safeParse(job.data);
      if (!payload.success || !job.id)
        throw new UnrecoverableError('Job CGU fora do contrato.');
      await this.cgu.execute({
        cnpj: payload.data.cnpj,
        context: { trigger: RequestTrigger.ON_DEMAND_JOB },
      });
      return { status: 'COLLECTED' };
    }
    const companyJob = job.name === INGEST_IBAMA_COMPANY_JOB;
    if (!companyJob && job.name !== INGEST_IBAMA_DUMPS_JOB) {
      throw new UnrecoverableError('Job desconhecido: "' + job.name + '".');
    }
    const companyPayload = companyJob
      ? IbamaCompanyJobPayloadSchema.safeParse(job.data)
      : undefined;
    if (
      companyJob
        ? !companyPayload?.success
        : !IbamaIngestionJobPayloadSchema.safeParse(job.data ?? {}).success
    ) {
      throw new UnrecoverableError('Payload do job fora do contrato.');
    }

    if (!job.id) throw new UnrecoverableError('Job sem identificador.');

    try {
      if (companyPayload?.success) {
        return await this.ingestIbamaCompany.execute({
          jobId: job.id,
          cnpj: companyPayload.data.cnpj,
        });
      }
      return await this.ingestIbamaDumps.execute({ jobId: job.id });
    } catch (error) {
      const message = describe(error);
      const retryable = !(error instanceof IbamaSourceDisabledError);
      const attempt = job.attemptsMade + 1;
      const attempts = job.opts.attempts ?? 1;

      this.logger.warn(
        `Coleta do IBAMA falhou (tentativa ${attempt} de ${attempts}): ${message}`,
      );

      if (!retryable || attempt >= attempts) {
        await this.markFailed(job.id, message);
      }

      throw retryable ? error : new UnrecoverableError(message);
    }
  }

  /**
   * Registra a falha definitiva na execução. Se nem isso for possível (o banco
   * caiu), o erro original é o que importa: ele segue para a fila, e este
   * apenas vai ao log.
   */
  private async markFailed(jobId: string, errorMessage: string): Promise<void> {
    try {
      await this.failIngestionRun.execute({
        sourceSlug: IBAMA_SLUG,
        jobId,
        errorMessage,
      });
    } catch (failure) {
      this.logger.error(
        `Execução do job ${jobId} não pôde ser marcada como FAILED: ${describe(failure)}`,
      );
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
