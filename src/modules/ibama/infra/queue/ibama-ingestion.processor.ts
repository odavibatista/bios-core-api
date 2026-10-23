import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { FailIngestionRunUseCase } from '@modules/data-sources/infra/usecases/ingestion/fail-ingestion-run.usecase.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { IbamaSourceDisabledError } from '../../domain/dtos/errors/ibama-ingestion.errors.js';
import {
  IbamaIngestionJobPayloadSchema,
  type IbamaIngestionJobResult,
  INGEST_IBAMA_DUMPS_JOB,
} from '../../domain/dtos/providers/ibama-ingestion-job.dto.js';
import {
  IbamaCompanyJobPayloadSchema,
  type IbamaCompanyJobResult,
  INGEST_IBAMA_COMPANY_JOB,
} from '../../domain/dtos/providers/ibama-company-job.dto.js';
import { IngestIbamaCompanyUseCase } from '../usecases/ingest-ibama-company.usecase.js';
import { IngestIbamaDumpsUseCase } from '../usecases/ingest-ibama-dumps.usecase.js';
import { IBAMA_SLUG } from '../providers/ibama.data-source.js';

/** Espera na fila acima da qual o adiamento é registrado no log. */
const DEFERRED_LOG_THRESHOLD_MS = 1_000;

/**
 * Consumidor dos jobs pesados do IBAMA (lote diário e coleta avulsa).
 *
 * Concorrência 1: no máximo um download de dumps (~330 MB) por vez, e esses
 * jobs não ocupam os workers da fila ambiental, que atende só a CGU a quem
 * espera a resposta (#262). Avulsos de CNPJs distintos aguardam na fila e
 * reaproveitam o mesmo download (`IbamaDumpLease`).
 */
@Processor(QueueName.IBAMA_INGESTION, { concurrency: 1 })
export class IbamaIngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IbamaIngestionProcessor.name);

  constructor(
    private readonly ingestIbamaDumps: IngestIbamaDumpsUseCase,
    private readonly ingestIbamaCompany: IngestIbamaCompanyUseCase,
    private readonly failIngestionRun: FailIngestionRunUseCase,
  ) {
    super();
  }

  async process(
    job: Job<unknown>,
  ): Promise<IbamaIngestionJobResult | IbamaCompanyJobResult> {
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

    const waitedMs =
      job.processedOn !== undefined && job.timestamp !== undefined
        ? job.processedOn - job.timestamp
        : 0;
    if (waitedMs >= DEFERRED_LOG_THRESHOLD_MS)
      this.logger.log(
        `Job ${job.name} adiado ${Math.round(waitedMs / 1000)} s: a fila do IBAMA processa um download por vez.`,
      );

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
