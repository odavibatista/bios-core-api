import { Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job, UnrecoverableError } from 'bullmq';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import {
  FETCH_GHG_INVENTORY_JOB,
  GhgJobSchema,
  GhgSyncJobPayloadSchema,
  SYNC_GHG_ORGANIZATIONS_JOB,
} from '../../domain/ghg-job.dto.js';
import { GhgSourceDisabledError } from '../providers/ghg-organization-directory.provider.js';
import { CollectGhgInventoryUseCase } from '../usecases/collect-ghg-inventory.usecase.js';
import { SyncGhgOrganizationsUseCase } from '../usecases/sync-ghg-organizations.usecase.js';
/**
 * Consumidor exclusivo do GHG, independente da fila ambiental. Despacha pelo
 * nome: a coleta de um CNPJ e a sincronização diária do cadastro de
 * organizações. Com concorrência 1, uma sincronização nunca corre junto de uma
 * coleta, que a esperaria de qualquer modo.
 */
@Processor(QueueName.GHG_INVENTORY, { concurrency: 1 })
export class GhgInventoryProcessor extends WorkerHost {
  constructor(
    private readonly collect: CollectGhgInventoryUseCase,
    private readonly syncOrganizations: SyncGhgOrganizationsUseCase,
  ) {
    super();
  }
  async process(job: Job<unknown>) {
    if (job.name === SYNC_GHG_ORGANIZATIONS_JOB) return this.sync(job);
    const input = GhgJobSchema.safeParse(job.data);
    if (
      job.name !== FETCH_GHG_INVENTORY_JOB ||
      !input.success ||
      parseCnpj(input.data.cnpj) !== input.data.cnpj
    )
      throw new UnrecoverableError('Job GHG inválido.');
    return this.collect.execute(input.data.cnpj);
  }
  /** O agendador publica o job sem carga; qualquer outra coisa é malformada. */
  private async sync(job: Job<unknown>) {
    if (!GhgSyncJobPayloadSchema.safeParse(job.data ?? {}).success)
      throw new UnrecoverableError('Job GHG inválido.');
    try {
      return await this.syncOrganizations.execute();
    } catch (error) {
      // Fonte desabilitada é decisão operacional: repetir não a reabilita.
      if (error instanceof GhgSourceDisabledError)
        throw new UnrecoverableError(error.message);
      throw error;
    }
  }
}
