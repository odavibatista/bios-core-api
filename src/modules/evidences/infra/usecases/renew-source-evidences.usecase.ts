import { Injectable } from '@nestjs/common';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import { ResolveEvidenceSourceUseCase } from '@modules/data-sources/infra/usecases/evidence/resolve-evidence-source.usecase.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { EvidenceSourceNotFoundError } from '../../domain/dtos/errors/evidence.errors.js';
import { EvidenceRepository } from '../../domain/dtos/repositories/evidence.repository.js';

export interface RenewSourceEvidencesInput {
  /** Fonte em lote cujas evidências são renovadas (ex.: `IBAMA`). */
  sourceSlug: string;

  /** Início da execução que confirmou que o dado segue o mesmo. */
  collectedAt: Date;
}

/**
 * Renova a validade das evidências de uma fonte em lote cujo dump não mudou
 * (UC14).
 *
 * Quando a execução do dia baixa um dump idêntico ao da anterior, não há o que
 * reprocessar, mas o dado **foi reconfirmado hoje**: a fonte continua dizendo o
 * mesmo. Sem esta renovação, a janela de validade (dois dias no IBAMA) venceria
 * durante um fim de semana ou feriado em que o órgão republica o mesmo arquivo,
 * e todas as evidências viriam como `OUTDATED` sem que nada tivesse mudado.
 *
 * Devolve quantas evidências renovou.
 *
 * @throws {EvidenceSourceNotFoundError} quando a fonte não é de evidências.
 */
@Injectable()
export class RenewSourceEvidencesUseCase extends UseCase<
  RenewSourceEvidencesInput,
  number
> {
  constructor(
    private readonly evidenceRepository: EvidenceRepository,
    private readonly resolveEvidenceSource: ResolveEvidenceSourceUseCase,
    private readonly resolveSourceCacheTtl: ResolveSourceCacheTtlUseCase,
  ) {
    super();
  }

  override async execute({
    sourceSlug,
    collectedAt,
  }: RenewSourceEvidencesInput): Promise<number> {
    const source = await this.resolveEvidenceSource.execute(sourceSlug);
    if (!source) throw new EvidenceSourceNotFoundError(sourceSlug);

    const ttlSeconds = await this.resolveSourceCacheTtl.execute(sourceSlug);

    return this.evidenceRepository.renewValidity(
      source.id,
      collectedAt,
      new Date(collectedAt.getTime() + ttlSeconds * 1_000),
    );
  }
}
