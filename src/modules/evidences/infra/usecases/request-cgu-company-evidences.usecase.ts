import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '@shared/config/environment.config.js';
import { EvidenceState } from '@prisma/client';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { QueueProvider } from '@shared/domain/providers/queue.provider.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { QueueTimeoutException } from '@shared/domain/errors/queue-timeout.exception.js';
import { QueueJobFailedException } from '@shared/domain/errors/queue-job-failed.exception.js';
import { DependencyUnavailableException } from '@shared/domain/errors/dependency-unavailable.exception.js';
import { CGU_SLUGS } from '@modules/cgu/domain/cgu-sanction.js';
import {
  CguJobSchema,
  cguJobId,
  FETCH_CGU_EVIDENCES_JOB,
} from '../../domain/cgu-job.dto.js';
import type { StoredEvidence } from '../../domain/dtos/repositories/evidence.repository.js';
import { ListCompanyEvidencesUseCase } from './list-company-evidences.usecase.js';
import { RecordEvidenceCollectionUseCase } from './record-evidence-collection.usecase.js';
/** Produtor sem HTTP: prepara UNKNOWN, publica uma vez e espera no limite global. */
@Injectable()
export class RequestCguCompanyEvidencesUseCase extends UseCase<
  string,
  StoredEvidence[]
> {
  private readonly logger = new Logger(RequestCguCompanyEvidencesUseCase.name);
  constructor(
    private readonly config: ConfigService<Environment, true>,
    private readonly list: ListCompanyEvidencesUseCase,
    private readonly collection: RecordEvidenceCollectionUseCase,
    private readonly queue: QueueProvider,
  ) {
    super();
  }
  override async execute(input: string): Promise<StoredEvidence[]> {
    const { cnpj } = CguJobSchema.parse({ cnpj: input });
    const local = await this.local(cnpj);
    const fresh = (slug: string) => {
      const rows = local.filter((e) => e.sourceSlug === slug);
      return (
        rows.length > 0 &&
        rows.every(
          (e) =>
            e.state !== EvidenceState.OUTDATED && e.validUntil > new Date(),
        )
      );
    };
    if (CGU_SLUGS.every(fresh)) return local;
    for (const slug of CGU_SLUGS) {
      if (!fresh(slug))
        await this.collection.execute({
          cnpj,
          sourceSlug: slug,
          result: { status: 'UNAVAILABLE' },
        });
    }
    const pending = await this.local(cnpj);
    if (!this.config.get('CGU_API_KEY', { infer: true })) {
      this.logger.warn(
        'CEIS/CNEP indisponíveis: credencial ausente (CGU_API_KEY).',
      );
      return pending;
    }
    try {
      await this.queue.enqueueAndWait(
        QueueName.ENVIRONMENTAL_EVIDENCES,
        FETCH_CGU_EVIDENCES_JOB,
        { cnpj },
        { jobId: cguJobId(cnpj, new Date()) },
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
    return (await this.list.execute(cnpj)).filter((e) =>
      CGU_SLUGS.some((slug) => slug === e.sourceSlug),
    );
  }
}
