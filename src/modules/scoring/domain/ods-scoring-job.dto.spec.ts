import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { QUEUE_SCHEDULES } from '@shared/config/queue.config.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import {
  RECALCULATE_SCORES_JOB,
  RECALCULATE_STALE_SCORES_JOB,
  RecalculateScoresJobSchema,
  RecalculateStaleScoresJobSchema,
  scoresJobId,
} from './ods-scoring-job.dto.js';

describe('contrato dos jobs de recálculo de índices', () => {
  const cnpj = buildCnpj();

  it('o jobId é o da empresa inteira, sem janela de tempo', () => {
    expect(scoresJobId(cnpj)).toBe(`scores-${cnpj}`);
    expect(scoresJobId(cnpj)).toBe(scoresJobId(cnpj));
  });

  it('o job por CNPJ aceita só o CNPJ', () => {
    expect(RecalculateScoresJobSchema.safeParse({ cnpj }).success).toBe(true);
    expect(RecalculateScoresJobSchema.safeParse({}).success).toBe(false);
    expect(
      RecalculateScoresJobSchema.safeParse({ cnpj, extra: 1 }).success,
    ).toBe(false);
  });

  it('a varredura não leva carga', () => {
    expect(RecalculateStaleScoresJobSchema.safeParse({}).success).toBe(true);
    expect(RecalculateStaleScoresJobSchema.safeParse({ cnpj }).success).toBe(
      false,
    );
  });

  it('o agendamento da varredura publica o job que o processor atende, na fila de scoring', () => {
    const sweep = QUEUE_SCHEDULES.find(
      ({ id }) => id === 'ods-stale-rules-sweep',
    );

    expect(sweep).toMatchObject({
      queue: QueueName.ODS_SCORING,
      jobName: RECALCULATE_STALE_SCORES_JOB,
    });
    expect(RECALCULATE_STALE_SCORES_JOB).not.toBe(RECALCULATE_SCORES_JOB);
  });
});
