import { EvidenceState } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import type { SourceCallContext } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { InvalidEvidenceError } from '@modules/evidences/domain/dtos/errors/evidence.errors.js';
import type { StoredEvidence } from '@modules/evidences/domain/dtos/repositories/evidence.repository.js';
import { RecordEvidenceEntriesUseCase } from '@modules/evidences/infra/usecases/record-evidence-entries.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { CGU_SLUGS, toCguEvidence } from '../../domain/cgu-sanction.js';
import { CeisDataSource } from '../providers/ceis.data-source.js';
import { CnepDataSource } from '../providers/cnep.data-source.js';

/** Consolida cada cadastro isoladamente, sem scoring nem bônus por ausência. */
@Injectable()
export class GetCguCompanyEvidencesUseCase extends UseCase<
  { cnpj: string; context: SourceCallContext },
  StoredEvidence[]
> {
  constructor(
    private readonly ceis: CeisDataSource,
    private readonly cnep: CnepDataSource,
    private readonly entries: RecordEvidenceEntriesUseCase,
    private readonly collection: RecordEvidenceCollectionUseCase,
    private readonly list: ListCompanyEvidencesUseCase,
  ) {
    super();
  }

  override async execute(input: {
    cnpj: string;
    context: SourceCallContext;
  }): Promise<StoredEvidence[]> {
    const cnpj = parseCnpj(input.cnpj);
    if (!cnpj)
      throw new InvalidEvidenceError('CNPJ inválido para consultar CGU.');
    const local = await this.list.execute(cnpj);
    const results = await Promise.allSettled(
      [this.ceis, this.cnep].map(async (adapter) => {
        const existing = local.filter((e) => e.sourceSlug === adapter.slug);
        if (
          existing.length &&
          existing.every(
            (e) =>
              e.state !== EvidenceState.UNKNOWN &&
              e.state !== EvidenceState.OUTDATED &&
              e.validUntil > new Date(),
          )
        )
          return;
        const result = await adapter.fetch(cnpj, input.context).catch(() => ({
          status: 'UNAVAILABLE' as const,
        }));
        if (result.status === 'UNAVAILABLE') {
          await this.collection.execute({
            cnpj,
            sourceSlug: adapter.slug,
            result: { status: 'UNAVAILABLE' },
          });
        } else {
          await this.entries.execute({
            cnpj,
            sourceSlug: adapter.slug,
            collectedAt: result.collectedAt,
            ingestionRunId: input.context.ingestionRunId,
            entries:
              result.status === 'FOUND'
                ? result.data.map((s) => toCguEvidence(s, adapter.slug))
                : [],
          });
        }
      }),
    );
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    return (await this.list.execute(cnpj)).filter((e) =>
      CGU_SLUGS.some((slug) => slug === e.sourceSlug),
    );
  }
}
