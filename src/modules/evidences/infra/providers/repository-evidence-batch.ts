import type { EvidenceSourceConfig } from '@modules/data-sources/domain/dtos/providers/evidence-source.dto.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import { contentHash } from '@shared/domain/canonical-json.js';
import { buildConfirmedEvidence } from '../../domain/confirmed-evidence.js';
import { InvalidEvidenceError } from '../../domain/dtos/errors/evidence.errors.js';
import type {
  EvidenceBatch,
  EvidenceBatchEntry,
} from '../../domain/dtos/providers/evidence-batch.dto.js';
import {
  EvidenceRepository,
  type EvidenceToSave,
} from '../../domain/dtos/repositories/evidence.repository.js';
import { RawEvidenceRepository } from '../../domain/dtos/repositories/raw-evidence.repository.js';

/** Quantos registros são gravados ao mesmo tempo (cada um são duas gravações no banco). */
export const BATCH_WRITE_CONCURRENCY = 25;

/**
 * Executa `task` para cada item, com no máximo `limit` em andamento. Na
 * primeira falha, não começa nenhum item novo e propaga o erro depois que os
 * em andamento terminam: nada fica gravando em segundo plano.
 */
async function forEachConcurrent<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failure: unknown;
  let failed = false;

  const worker = async () => {
    while (!failed && next < items.length) {
      const item = items[next++];

      try {
        await task(item);
      } catch (error) {
        failed = true;
        failure = error;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );

  if (failed) throw failure;
}

/** Carga em lote de uma fonte, gravando pelos repositórios (ver `EvidenceBatch`). */
export class RepositoryEvidenceBatch implements EvidenceBatch {
  /** Empresas com evidência gravada por esta carga (a memória cresce com as empresas, não com os registros). */
  private readonly written = new Set<string>();

  constructor(
    private readonly evidenceRepository: EvidenceRepository,
    private readonly rawEvidenceRepository: RawEvidenceRepository,
    private readonly source: EvidenceSourceConfig,
    private readonly collectedAt: Date,
    private readonly validUntil: Date,
    private readonly ingestionRunId: string | null,
  ) {}

  get sourceSlug(): string {
    return this.source.slug;
  }

  async write(entries: readonly EvidenceBatchEntry[]): Promise<number> {
    // Valida e monta tudo antes de gravar qualquer coisa: um registro inválido
    // não deixa o lote pela metade.
    const byKey = new Map<
      string,
      { evidence: EvidenceToSave; entry: EvidenceBatchEntry }
    >();

    for (const entry of entries) {
      if (parseCnpj(entry.cnpj) !== entry.cnpj) {
        throw new InvalidEvidenceError(
          `CNPJ "${entry.cnpj}" não é canônico e válido.`,
        );
      }

      const evidence = buildConfirmedEvidence(entry.finding, {
        cnpj: entry.cnpj,
        source: this.source,
        collectedAt: this.collectedAt,
        validUntil: this.validUntil,
      });

      byKey.set(evidence.key, { evidence, entry });
    }

    for (const { entry } of byKey.values()) this.written.add(entry.cnpj);

    await forEachConcurrent(
      [...byKey.values()],
      BATCH_WRITE_CONCURRENCY,
      async ({ evidence, entry }) => {
        const rawEvidenceId = await this.rawEvidenceRepository.save({
          dataSourceId: this.source.id,
          ingestionRunId: this.ingestionRunId,
          cnpj: entry.cnpj,
          externalReference: evidence.sourceReference ?? '',
          payload: entry.raw,
          payloadHash: contentHash({ key: evidence.key, raw: entry.raw }),
          collectedAt: this.collectedAt,
        });

        await this.evidenceRepository.save({ ...evidence, rawEvidenceId });
      },
    );

    return byKey.size;
  }

  async finish(): Promise<{ removed: number; affectedCnpjs: string[] }> {
    // Os donos do que vai ser removido são lidos antes: depois, não há mais como saber.
    const owners = await this.evidenceRepository.findCnpjsNotCollectedSince(
      this.source.id,
      this.collectedAt,
    );
    const removed = await this.evidenceRepository.deleteNotCollectedSince(
      this.source.id,
      this.collectedAt,
    );

    return {
      removed,
      affectedCnpjs: [...new Set([...this.written, ...owners])],
    };
  }
}
