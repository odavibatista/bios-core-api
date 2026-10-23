import { Injectable } from '@nestjs/common';
import { EvidenceState } from '@prisma/client';
import { ResolveEvidenceSourceUseCase } from '@modules/data-sources/infra/usecases/evidence/resolve-evidence-source.usecase.js';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import type { EvidenceSourceConfig } from '@modules/data-sources/domain/dtos/providers/evidence-source.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import {
  EvidenceSourceNotFoundError,
  InvalidEvidenceError,
} from '../../domain/dtos/errors/evidence.errors.js';
import type {
  EvidenceFinding,
  RecordEvidenceCollectionInput,
  RecordEvidenceCollectionOutput,
} from '../../domain/dtos/providers/evidence-collection.dto.js';
import {
  EvidenceRepository,
  type EvidenceToSave,
} from '../../domain/dtos/repositories/evidence.repository.js';
import {
  baseEvidence,
  buildConfirmedEvidence,
  type EvidenceBuildContext,
} from '../../domain/confirmed-evidence.js';
import { buildPlaceholderKey } from '../../domain/evidence-key.js';
import { UNKNOWN_RETRY_WINDOW_SECONDS } from '../../domain/evidence-rules.js';

/**
 * Grava o resultado de consultar uma fonte de evidências para um CNPJ (RF08).
 *
 * O resultado da coleta é um **retrato da fonte para aquela empresa**, e a
 * gravação o torna o retrato vigente:
 *
 *  - **a fonte respondeu com registros:** cada um vira uma evidência
 *    `CONFIRMED` (criada ou atualizada pela chave); o que a fonte tinha antes
 *    e agora não lista, inclusive um `NOT_FOUND` ou `UNKNOWN` antigo, é
 *    removido. Sem isso, a empresa teria ao mesmo tempo uma infração
 *    confirmada e um "nada encontrado";
 *  - **a fonte respondeu sem registro:** uma evidência `NOT_FOUND` substitui
 *    as anteriores da fonte. É a única forma de dizer "consultamos e não há",
 *    distinta de "não conseguimos consultar" (IND02);
 *  - **a fonte não respondeu:** nada do que se sabia é apagado. Se já havia uma
 *    coleta que respondeu, ela fica e envelhece até `OUTDATED` pelo prazo
 *    (UC14, fluxo 2.1); se não havia, grava-se `UNKNOWN`, que não pontua e só
 *    reduz a confiança.
 *
 * Repetir a mesma coleta não duplica nada: as chaves são determinísticas, e a
 * validade é renovada. A categoria e o ODS vêm do catálogo da fonte; a validade
 * é a janela configurada nela (`cache_ttl_seconds`). Cada passo é idempotente,
 * então uma falha no meio é corrigida repetindo a coleta (a fila já repete).
 *
 * @throws {EvidenceSourceNotFoundError} quando a fonte não é de evidências.
 * @throws {InvalidEvidenceError} quando o CNPJ ou um registro é inválido.
 */
@Injectable()
export class RecordEvidenceCollectionUseCase extends UseCase<
  RecordEvidenceCollectionInput,
  RecordEvidenceCollectionOutput
> {
  constructor(
    private readonly evidenceRepository: EvidenceRepository,
    private readonly resolveEvidenceSource: ResolveEvidenceSourceUseCase,
    private readonly resolveSourceCacheTtl: ResolveSourceCacheTtlUseCase,
  ) {
    super();
  }

  override async execute({
    cnpj,
    sourceSlug,
    result,
    collectedAt = new Date(),
  }: RecordEvidenceCollectionInput): Promise<RecordEvidenceCollectionOutput> {
    if (parseCnpj(cnpj) !== cnpj) {
      throw new InvalidEvidenceError(`CNPJ "${cnpj}" não é canônico e válido.`);
    }

    const source = await this.resolveEvidenceSource.execute(sourceSlug);
    if (!source) throw new EvidenceSourceNotFoundError(sourceSlug);

    const context = { cnpj, source, collectedAt };

    if (result.status === 'UNAVAILABLE') {
      return this.recordUnavailable(context);
    }

    const validUntil = await this.validityFrom(collectedAt, sourceSlug);
    const evidences =
      result.findings.length > 0
        ? toConfirmedEvidences(result.findings, { ...context, validUntil })
        : [placeholder(EvidenceState.NOT_FOUND, { ...context, validUntil })];

    return this.replaceSnapshot(context, evidences);
  }

  private async recordUnavailable(context: Context) {
    const { collectedAt } = context;

    // Uma coleta anterior que respondeu continua valendo até o prazo: perder a
    // fonte por uns minutos não pode apagar o que ela já tinha dito.
    const unknown = placeholder(EvidenceState.UNKNOWN, {
      ...context,
      validUntil: addSeconds(collectedAt, UNKNOWN_RETRY_WINDOW_SECONDS),
    });

    return this.replaceSnapshot(context, [unknown], true);
  }

  private async replaceSnapshot(
    { cnpj, source }: Context,
    evidences: EvidenceToSave[],
    ifUnanswered = false,
  ): Promise<RecordEvidenceCollectionOutput> {
    return this.evidenceRepository.replaceSnapshot(
      cnpj,
      source.id,
      evidences[0].collectedAt,
      evidences,
      ifUnanswered,
    );
  }

  private async validityFrom(
    collectedAt: Date,
    sourceSlug: string,
  ): Promise<Date> {
    return addSeconds(
      collectedAt,
      await this.resolveSourceCacheTtl.execute(sourceSlug),
    );
  }
}

interface Context {
  cnpj: string;
  source: EvidenceSourceConfig;
  collectedAt: Date;
}

type ValidContext = EvidenceBuildContext;

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
}

/**
 * Uma evidência por registro. Se a fonte repete a mesma chave na coleta, vale a
 * última: duas gravações com a mesma chave só se sobrescreveriam.
 */
function toConfirmedEvidences(
  findings: readonly EvidenceFinding[],
  context: ValidContext,
): EvidenceToSave[] {
  const byKey = new Map<string, EvidenceToSave>();

  for (const finding of findings) {
    const evidence = buildConfirmedEvidence(finding, context);

    byKey.set(evidence.key, evidence);
  }

  return [...byKey.values()];
}

function placeholder(
  state: typeof EvidenceState.NOT_FOUND | typeof EvidenceState.UNKNOWN,
  context: ValidContext,
): EvidenceToSave {
  return {
    ...baseEvidence(context),
    key: buildPlaceholderKey(context.source.slug, context.cnpj, state),
    state,
    summary: null,
    sourceReference: null,
    sourceUrl: null,
    details: null,
    publishedAt: null,
    rawEvidenceId: null,
  };
}
