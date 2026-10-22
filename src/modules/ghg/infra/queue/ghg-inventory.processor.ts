import { Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job, UnrecoverableError } from 'bullmq';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import {
  FETCH_GHG_INVENTORY_JOB,
  GhgJobSchema,
} from '../../domain/ghg-job.dto.js';
import { CollectGhgInventoryUseCase } from '../usecases/collect-ghg-inventory.usecase.js';
/** Consumidor exclusivo do GHG, independente da fila ambiental. */
@Processor(QueueName.GHG_INVENTORY, { concurrency: 1 })
export class GhgInventoryProcessor extends WorkerHost {
  constructor(private readonly collect: CollectGhgInventoryUseCase) {
    super();
  }
  async process(job: Job<unknown>) {
    const input = GhgJobSchema.safeParse(job.data);
    if (
      job.name !== FETCH_GHG_INVENTORY_JOB ||
      !input.success ||
      parseCnpj(input.data.cnpj) !== input.data.cnpj
    )
      throw new UnrecoverableError('Job GHG invalido.');
    return this.collect.execute(input.data.cnpj);
  }
}
