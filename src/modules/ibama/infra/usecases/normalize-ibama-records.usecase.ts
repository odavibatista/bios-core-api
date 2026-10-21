import { Injectable, Logger } from '@nestjs/common';
import type {
  EvidenceBatch,
  EvidenceBatchEntry,
} from '@modules/evidences/domain/dtos/providers/evidence-batch.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import type { IbamaRecord } from '../../domain/dtos/providers/ibama-dump.dto.js';
import { toEvidenceEntry } from '../../domain/ibama-evidence.mapper.js';

/** Registros gravados por vez: o bastante para a gravação em paralelo render, sem encher a memória. */
export const NORMALIZATION_CHUNK_SIZE = 200;

/** De quantos em quantos registros lidos o progresso vai ao log. */
const PROGRESS_LOG_INTERVAL = 50_000;

export interface NormalizeIbamaRecordsInput {
  /** Os registros de pessoa jurídica do dump (`IbamaDump.records()`). */
  records: AsyncIterable<IbamaRecord>;

  /** A carga em lote de evidências do IBAMA, já aberta; quem a abriu a encerra. */
  batch: EvidenceBatch;
}

export interface NormalizeIbamaRecordsOutput {
  /** Registros lidos do dump. */
  read: number;

  /** Registros que não viraram evidência por terem sido anulados no IBAMA. */
  annulled: number;

  /** Evidências gravadas (uma chave repetida num mesmo lote de gravação vale uma). */
  written: number;
}

/**
 * Normaliza os registros do IBAMA em evidências por CNPJ e as grava, junto do
 * registro bruto, pela carga em lote (UC14, passos 3 e 4; RF08).
 *
 * Os registros chegam em fluxo e são gravados em lotes pequenos, então a
 * memória não cresce com o tamanho do dump (o auto de infração tem centenas de
 * milhares de registros). Os anulados (cancelados, excluídos, substituídos)
 * são pulados e contados: uma infração anulada não é evidência.
 *
 * Este caso de uso **não encerra a carga**: remover o que o dump deixou de
 * listar (`batch.finish()`) só é seguro depois que **todos** os recursos do
 * IBAMA foram carregados, e isso é de quem orquestra a ingestão.
 */
@Injectable()
export class NormalizeIbamaRecordsUseCase extends UseCase<
  NormalizeIbamaRecordsInput,
  NormalizeIbamaRecordsOutput
> {
  private readonly logger = new Logger(NormalizeIbamaRecordsUseCase.name);

  override async execute({
    records,
    batch,
  }: NormalizeIbamaRecordsInput): Promise<NormalizeIbamaRecordsOutput> {
    let read = 0;
    let annulled = 0;
    let written = 0;
    let chunk: EvidenceBatchEntry[] = [];

    const flush = async () => {
      if (chunk.length === 0) return;

      written += await batch.write(chunk);
      chunk = [];
    };

    for await (const record of records) {
      read += 1;

      const entry = toEvidenceEntry(record);

      if (entry === null) {
        annulled += 1;
      } else {
        chunk.push(entry);
      }

      if (chunk.length >= NORMALIZATION_CHUNK_SIZE) await flush();

      if (read % PROGRESS_LOG_INTERVAL === 0) {
        this.logger.log(
          `IBAMA: ${read} registros lidos, ${written} evidências gravadas.`,
        );
      }
    }

    await flush();

    return { read, annulled, written };
  }
}
