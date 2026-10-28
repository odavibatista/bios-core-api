import { Injectable } from '@nestjs/common';
import { EvidenceState } from '@prisma/client';
import { ResolveSourceRequestConfigUseCase } from '@modules/data-sources/infra/usecases/request/resolve-source-request-config.usecase.js';
import { DEFAULT_REQUEST_TIMEOUT_MS } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { InvalidEvidenceError } from '@modules/evidences/domain/dtos/errors/evidence.errors.js';
import type { StoredEvidence } from '@modules/evidences/domain/dtos/repositories/evidence.repository.js';
import { QueueProvider } from '@shared/domain/providers/queue.provider.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import { QueueTimeoutException } from '@shared/domain/errors/queue-timeout.exception.js';
import { QueueJobFailedException } from '@shared/domain/errors/queue-job-failed.exception.js';
import { DependencyUnavailableException } from '@shared/domain/errors/dependency-unavailable.exception.js';
import { GHG_SLUG } from '../../domain/ghg-inventory.js';
import { FETCH_GHG_INVENTORY_JOB, ghgJobId } from '../../domain/ghg-job.dto.js';

/** Como a coleta sob demanda se comporta diante da fonte (#333). */
export interface GhgCollectionOptions {
  /**
   * Espera o job terminar, no prazo da fila (padrão). Falso: serve o que está guardado,
   * publica a atualização e volta sem esperar (API pública).
   */
  wait?: boolean;
}

/** Consulta local e espera limitada pela fila; nenhuma chamada remota no produtor. */
@Injectable()
export class GetGhgCompanyEvidencesUseCase extends UseCase<
  string,
  StoredEvidence[]
> {
  constructor(
    private readonly list: ListCompanyEvidencesUseCase,
    private readonly collection: RecordEvidenceCollectionUseCase,
    private readonly source: ResolveSourceRequestConfigUseCase,
    private readonly queue: QueueProvider,
  ) {
    super();
  }
  override async execute(
    input: string,
    { wait = true }: GhgCollectionOptions = {},
  ): Promise<StoredEvidence[]> {
    const cnpj = parseCnpj(input);
    if (!cnpj)
      throw new InvalidEvidenceError('CNPJ inválido para consultar GHG.');
    const local = await this.local(cnpj);
    if (
      local.length &&
      local.every(
        (e) => e.state !== EvidenceState.OUTDATED && e.validUntil > new Date(),
      )
    )
      return local;
    // Antes da publicacao: nao sobrescrever o resultado de um worker rapido.
    await this.collection.execute({
      cnpj,
      sourceSlug: GHG_SLUG,
      result: { status: 'UNAVAILABLE' },
    });
    const pending = await this.local(cnpj);
    const config = await this.source.execute(GHG_SLUG);
    if (!config?.isEnabled) return pending;
    try {
      const jobId = ghgJobId(cnpj, new Date());

      if (!wait) {
        await this.queue.enqueue(
          QueueName.GHG_INVENTORY,
          FETCH_GHG_INVENTORY_JOB,
          { cnpj },
          { jobId },
        );
        return pending;
      }

      await this.queue.enqueueAndWait(
        QueueName.GHG_INVENTORY,
        FETCH_GHG_INVENTORY_JOB,
        { cnpj },
        {
          jobId,
          timeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        },
      );
      return await this.local(cnpj);
    } catch (error) {
      if (!(
        error instanceof QueueTimeoutException ||
        error instanceof QueueJobFailedException ||
        error instanceof DependencyUnavailableException
      ))
        throw error;
      return pending;
    }
  }
  private async local(cnpj: string) {
    return (await this.list.execute(cnpj)).filter(
      (e) => e.sourceSlug === GHG_SLUG,
    );
  }
}
