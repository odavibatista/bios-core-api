import { Injectable } from '@nestjs/common';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import { ResolveEvidenceSourceUseCase } from '@modules/data-sources/infra/usecases/evidence/resolve-evidence-source.usecase.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { EvidenceSourceNotFoundError } from '../../domain/dtos/errors/evidence.errors.js';
import type {
  EvidenceBatch,
  OpenEvidenceBatchInput,
} from '../../domain/dtos/providers/evidence-batch.dto.js';
import { EvidenceRepository } from '../../domain/dtos/repositories/evidence.repository.js';
import { RawEvidenceRepository } from '../../domain/dtos/repositories/raw-evidence.repository.js';
import { RepositoryEvidenceBatch } from '../providers/repository-evidence-batch.js';

/**
 * Abre uma carga em lote de uma fonte de evidências (UC14; ver `EvidenceBatch`).
 *
 * A fonte (categoria e ODS) e a janela de validade são lidas do catálogo uma
 * vez, na abertura, e valem para a carga inteira: não há consulta ao catálogo
 * por registro, o que importaria com centenas de milhares deles.
 *
 * @throws {EvidenceSourceNotFoundError} quando a fonte não é de evidências.
 */
@Injectable()
export class OpenEvidenceBatchUseCase extends UseCase<
  OpenEvidenceBatchInput,
  EvidenceBatch
> {
  constructor(
    private readonly evidenceRepository: EvidenceRepository,
    private readonly rawEvidenceRepository: RawEvidenceRepository,
    private readonly resolveEvidenceSource: ResolveEvidenceSourceUseCase,
    private readonly resolveSourceCacheTtl: ResolveSourceCacheTtlUseCase,
  ) {
    super();
  }

  override async execute({
    sourceSlug,
    collectedAt,
    ingestionRunId,
  }: OpenEvidenceBatchInput): Promise<EvidenceBatch> {
    const source = await this.resolveEvidenceSource.execute(sourceSlug);
    if (!source) throw new EvidenceSourceNotFoundError(sourceSlug);

    const ttlSeconds = await this.resolveSourceCacheTtl.execute(sourceSlug);

    return new RepositoryEvidenceBatch(
      this.evidenceRepository,
      this.rawEvidenceRepository,
      source,
      collectedAt,
      new Date(collectedAt.getTime() + ttlSeconds * 1_000),
      ingestionRunId ?? null,
    );
  }
}
