import { RequestTrigger } from '@prisma/client';
import { GetCguCompanyEvidencesUseCase } from '@modules/cgu/infra/usecases/get-cgu-company-evidences.usecase.js';
import {
  CguJobSchema,
  FETCH_CGU_EVIDENCES_JOB,
} from '../../domain/cgu-job.dto.js';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job, UnrecoverableError } from 'bullmq';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';

/**
 * Consumidor da fila ambiental: só a CGU (CEIS/CNEP), jobs curtos de quem espera
 * a resposta. Os dumps do IBAMA têm fila e consumidor próprios
 * (`IbamaIngestionProcessor`), para nunca disputarem estes workers (#262).
 * GHG permanece em sua fila exclusiva.
 */
@Processor(QueueName.ENVIRONMENTAL_EVIDENCES, { concurrency: 3 })
export class EnvironmentalEvidencesProcessor extends WorkerHost {
  constructor(private readonly cgu: GetCguCompanyEvidencesUseCase) {
    super();
  }

  async process(job: Job<unknown>): Promise<{ status: 'COLLECTED' }> {
    if (job.name !== FETCH_CGU_EVIDENCES_JOB)
      throw new UnrecoverableError('Job desconhecido: "' + job.name + '".');
    const payload = CguJobSchema.safeParse(job.data);
    if (!payload.success || !job.id)
      throw new UnrecoverableError('Job CGU fora do contrato.');
    await this.cgu.execute({
      cnpj: payload.data.cnpj,
      context: { trigger: RequestTrigger.ON_DEMAND_JOB },
    });
    return { status: 'COLLECTED' };
  }
}
