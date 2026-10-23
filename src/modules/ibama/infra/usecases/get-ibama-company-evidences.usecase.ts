import { Injectable, Logger } from '@nestjs/common';
import { EvidenceState } from '@prisma/client';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import { FindLastConfirmedBatchUseCase } from '@modules/data-sources/infra/usecases/ingestion/find-last-confirmed-batch.usecase.js';
import type { StoredEvidence } from '@modules/evidences/domain/dtos/repositories/evidence.repository.js';
import { InvalidEvidenceError } from '@modules/evidences/domain/dtos/errors/evidence.errors.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { DependencyUnavailableException } from '@shared/domain/errors/dependency-unavailable.exception.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { QueueProvider } from '@shared/domain/providers/queue.provider.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import {
  ibamaCompanyJobId,
  INGEST_IBAMA_COMPANY_JOB,
} from '../../domain/dtos/providers/ibama-company-job.dto.js';
import { IBAMA_SLUG } from '../providers/ibama.data-source.js';

/**
 * Consulta o índice local do IBAMA e publica a atualização avulsa sem esperá-la.
 * Sem resposta anterior, UNKNOWN é gravado antes de publicar: o consumidor pode
 * concluir imediatamente e o produtor nunca deve sobrescrever sua resposta.
 */
@Injectable()
export class GetIbamaCompanyEvidencesUseCase extends UseCase<
  string,
  StoredEvidence[]
> {
  private readonly logger = new Logger(GetIbamaCompanyEvidencesUseCase.name);

  constructor(
    private readonly list: ListCompanyEvidencesUseCase,
    private readonly lastBatch: FindLastConfirmedBatchUseCase,
    private readonly ttl: ResolveSourceCacheTtlUseCase,
    private readonly recordCollection: RecordEvidenceCollectionUseCase,
    private readonly queue: QueueProvider,
  ) {
    super();
  }

  override async execute(input: string): Promise<StoredEvidence[]> {
    const cnpj = parseCnpj(input);
    if (!cnpj)
      throw new InvalidEvidenceError(
        'CNPJ inválido para consultar evidências do IBAMA.',
      );
    const now = new Date();
    const local = await this.local(cnpj);
    if (
      local.length > 0 &&
      local.every(
        (e) =>
          e.state !== EvidenceState.UNKNOWN &&
          e.state !== EvidenceState.OUTDATED &&
          e.validUntil > now,
      )
    ) {
      return local;
    }

    const batch = await this.lastBatch.execute(IBAMA_SLUG);
    // A ausência no lote completo foi uma consulta à fonte, com a data do lote;
    // consultar o perfil não pode esticar indefinidamente a validade do índice.
    if (
      batch?.startedAt &&
      batch.finishedAt &&
      batch.startedAt.getTime() + (await this.ttl.execute(IBAMA_SLUG)) * 1000 >
        now.getTime() &&
      local.every((e) => e.state === EvidenceState.UNKNOWN)
    ) {
      await this.recordCollection.execute({
        cnpj,
        sourceSlug: IBAMA_SLUG,
        collectedAt: batch.startedAt,
        result: { status: 'COLLECTED', findings: [] },
      });
      return this.local(cnpj);
    }

    if (
      local.length > 0 &&
      local.every(
        (e) => e.state === EvidenceState.UNKNOWN && e.validUntil > now,
      )
    )
      return local;

    await this.recordCollection.execute({
      cnpj,
      sourceSlug: IBAMA_SLUG,
      result: { status: 'UNAVAILABLE' },
      collectedAt: now,
    });
    const pending = await this.local(cnpj);
    try {
      await this.queue.enqueue(
        QueueName.IBAMA_INGESTION,
        INGEST_IBAMA_COMPANY_JOB,
        { cnpj },
        { jobId: ibamaCompanyJobId(cnpj, now) },
      );
    } catch (error) {
      if (!(error instanceof DependencyUnavailableException)) throw error;
      this.logger.warn(
        'Coleta avulsa do IBAMA não publicada: fila indisponível.',
      );
    }
    return pending;
  }

  private async local(cnpj: string): Promise<StoredEvidence[]> {
    return (await this.list.execute(cnpj)).filter(
      (e) => e.sourceSlug === IBAMA_SLUG,
    );
  }
}
