import { Injectable } from '@nestjs/common';
import { ResolveEvidenceSourceUseCase } from '@modules/data-sources/infra/usecases/evidence/resolve-evidence-source.usecase.js';
import { contentHash } from '@shared/domain/canonical-json.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import { buildConfirmedEvidence } from '../../domain/confirmed-evidence.js';
import {
  EvidenceSourceNotFoundError,
  InvalidEvidenceError,
} from '../../domain/dtos/errors/evidence.errors.js';
import type { EvidenceBatchEntry } from '../../domain/dtos/providers/evidence-batch.dto.js';
import type {
  EvidenceFinding,
  RecordEvidenceCollectionOutput,
} from '../../domain/dtos/providers/evidence-collection.dto.js';
import { RawEvidenceRepository } from '../../domain/dtos/repositories/raw-evidence.repository.js';
import { RecordEvidenceCollectionUseCase } from './record-evidence-collection.usecase.js';

export interface RecordEvidenceEntriesInput {
  cnpj: string;
  sourceSlug: string;
  entries: readonly EvidenceBatchEntry[];
  collectedAt: Date;
  ingestionRunId: string;
}

/**
 * Grava bruto e retrato de uma única empresa, depois de a fonte terminar de ler.
 * Não usa finish de lote: o avulso não pode remover evidências de outras empresas.
 */
@Injectable()
export class RecordEvidenceEntriesUseCase extends UseCase<
  RecordEvidenceEntriesInput,
  RecordEvidenceCollectionOutput
> {
  constructor(
    private readonly sources: ResolveEvidenceSourceUseCase,
    private readonly raw: RawEvidenceRepository,
    private readonly recordCollection: RecordEvidenceCollectionUseCase,
  ) {
    super();
  }

  override async execute(
    input: RecordEvidenceEntriesInput,
  ): Promise<RecordEvidenceCollectionOutput> {
    const { cnpj, sourceSlug, collectedAt, ingestionRunId } = input;
    if (
      parseCnpj(cnpj) !== cnpj ||
      input.entries.some((entry) => entry.cnpj !== cnpj)
    ) {
      throw new InvalidEvidenceError(
        'A coleta avulsa deve conter apenas o CNPJ canônico solicitado.',
      );
    }
    const source = await this.sources.execute(sourceSlug);
    if (!source) throw new EvidenceSourceNotFoundError(sourceSlug);
    // Valida todos antes de persistir até mesmo o bruto.
    const entries = input.entries.map((entry) => ({
      entry,
      evidence: buildConfirmedEvidence(entry.finding, {
        cnpj,
        source,
        collectedAt,
        validUntil: collectedAt,
      }),
    }));
    const findings: EvidenceFinding[] = [];
    for (const { entry, evidence } of entries) {
      const rawEvidenceId = await this.raw.save({
        dataSourceId: source.id,
        ingestionRunId,
        cnpj,
        externalReference: evidence.sourceReference ?? '',
        payload: entry.raw,
        payloadHash: contentHash({ key: evidence.key, raw: entry.raw }),
        collectedAt,
      });
      findings.push({ ...entry.finding, rawEvidenceId });
    }
    return this.recordCollection.execute({
      cnpj,
      sourceSlug,
      collectedAt,
      result: { status: 'COLLECTED', findings },
    });
  }
}
