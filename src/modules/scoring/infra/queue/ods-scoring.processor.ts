import { Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job, UnrecoverableError } from 'bullmq';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import { ScoringNotConfiguredError } from '../../domain/dtos/errors/scoring-not-configured.error.js';
import {
  AGGREGATE_SECTOR_SCORES_JOB,
  AggregateSectorScoresJobSchema,
  type AggregateSectorScoresJobResult,
  RECALCULATE_SCORES_JOB,
  RECALCULATE_STALE_SCORES_JOB,
  RecalculateScoresJobSchema,
  RecalculateStaleScoresJobSchema,
  type RecalculateScoresJobResult,
  type RecalculateStaleScoresJobResult,
} from '../../domain/ods-scoring-job.dto.js';
import { AggregateSectorScoresUseCase } from '../usecases/aggregate-sector-scores.usecase.js';
import { CalculateCompanyOdsScoresUseCase } from '../usecases/calculate-company-ods-scores.usecase.js';
import { RecalculateStaleScoresUseCase } from '../usecases/recalculate-stale-scores.usecase.js';

/**
 * O que o recálculo torna velho no cache de um CNPJ: o perfil, as evidências consolidadas e
 * as notas. **Não** inclui os retratos das fontes (CGU, GHG): eles não dependem do índice,
 * e apagá-los forçaria novas consultas externas a cada recálculo (`CacheProvider.invalidate`
 * apagaria tudo do CNPJ, por isso não é usado aqui).
 */
const STALE_AFTER_RECALCULATION = [
  CacheNamespace.COMPANY_PROFILE,
  CacheNamespace.COMPANY_EVIDENCES,
  CacheNamespace.COMPANY_SCORES,
] as const;

/**
 * Consumidor da fila `ods-scoring` (UC15, #80): o recálculo de índice e confiança de um
 * CNPJ e a varredura agendada por versão de regras.
 *
 * Ao final de cada recálculo, o cache derivado do CNPJ é invalidado (perfil, evidências e
 * notas saem juntos): a próxima leitura traz o índice novo. Apagar nunca falha por causa do
 * cache (`CacheProvider`).
 *
 * Job malformado e ambiente sem ODS ou sem regras são irrecuperáveis: repetir não ajuda,
 * e quem espera pelo recálculo recebe a falha na hora, em vez de esperar o fim das tentativas.
 */
@Processor(QueueName.ODS_SCORING, { concurrency: 3 })
export class OdsScoringProcessor extends WorkerHost {
  constructor(
    private readonly calculate: CalculateCompanyOdsScoresUseCase,
    private readonly stale: RecalculateStaleScoresUseCase,
    private readonly cache: CacheProvider,
    private readonly sectors: AggregateSectorScoresUseCase,
  ) {
    super();
  }

  async process(
    job: Job<unknown>,
  ): Promise<
    | RecalculateScoresJobResult
    | RecalculateStaleScoresJobResult
    | AggregateSectorScoresJobResult
  > {
    if (job.name === RECALCULATE_STALE_SCORES_JOB) return this.sweep(job);
    if (job.name === AGGREGATE_SECTOR_SCORES_JOB) {
      return this.aggregateSectors(job);
    }

    if (job.name !== RECALCULATE_SCORES_JOB) {
      throw new UnrecoverableError(`Job desconhecido: "${job.name}".`);
    }

    const payload = RecalculateScoresJobSchema.safeParse(job.data);

    if (
      !payload.success ||
      parseCnpj(payload.data.cnpj) !== payload.data.cnpj
    ) {
      throw new UnrecoverableError('Job de recálculo fora do contrato.');
    }

    const { cnpj } = payload.data;

    try {
      const scores = await this.calculate.execute(cnpj);

      for (const namespace of STALE_AFTER_RECALCULATION) {
        await this.cache.delete({ namespace, identifier: cnpj });
      }

      return { status: 'CALCULATED', odsCount: scores.length };
    } catch (error) {
      if (error instanceof ScoringNotConfiguredError) {
        throw new UnrecoverableError(error.message);
      }

      throw error;
    }
  }

  /** O agendador publica a varredura sem carga; qualquer outra coisa é malformada. */
  private sweep(job: Job<unknown>): Promise<RecalculateStaleScoresJobResult> {
    if (!RecalculateStaleScoresJobSchema.safeParse(job.data ?? {}).success) {
      throw new UnrecoverableError('Job de recálculo fora do contrato.');
    }

    return this.stale.execute();
  }

  /** Agregados setoriais do mês corrente (#89); o agendador publica sem carga. */
  private aggregateSectors(
    job: Job<unknown>,
  ): Promise<AggregateSectorScoresJobResult> {
    if (!AggregateSectorScoresJobSchema.safeParse(job.data ?? {}).success) {
      throw new UnrecoverableError(
        'Job de agregados setoriais fora do contrato.',
      );
    }

    return this.sectors.execute(new Date());
  }
}
