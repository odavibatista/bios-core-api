import type { Prisma } from '@prisma/client';
import type { EvidenceFinding } from './evidence-collection.dto.js';

/** Um registro de uma carga em lote: a empresa, a evidência e o registro bruto de origem. */
export interface EvidenceBatchEntry {
  /** CNPJ canônico da empresa. */
  cnpj: string;

  /** A evidência a gravar, sem o vínculo com o registro bruto (a carga o cria). */
  finding: Omit<EvidenceFinding, 'rawEvidenceId'>;

  /** O registro como a fonte o entregou, já reduzido às colunas permitidas. */
  raw: Prisma.InputJsonValue;
}

/**
 * Carga em lote de uma fonte de evidências (UC14): o dump diário do IBAMA, com
 * centenas de milhares de registros de muitas empresas.
 *
 * Diferente de `RecordEvidenceCollectionUseCase`, que grava o retrato de **uma**
 * empresa, a carga em lote é **em fluxo**: cada registro é gravado ao chegar
 * (a memória não cresce com o tamanho do dump), e só no fim, em `finish`, sai o
 * que a carga não renovou. Falhar no meio não apaga nada: quem não chamou
 * `finish` não removeu evidência alguma, e o que foi gravado é renovado de novo
 * na próxima tentativa.
 */
export interface EvidenceBatch {
  /** Fonte da carga (ex.: `IBAMA`). */
  readonly sourceSlug: string;

  /**
   * Grava os registros: o bruto (uma vez por conteúdo) e a evidência `CONFIRMED`
   * (criada ou atualizada pela chave, com a validade renovada). Devolve quantas
   * evidências gravou; uma chave repetida no mesmo lote vale uma vez só, a
   * última.
   *
   * @throws {InvalidEvidenceError} quando um CNPJ ou um registro é inválido.
   */
  write(entries: readonly EvidenceBatchEntry[]): Promise<number>;

  /**
   * Encerra a carga: remove as evidências da fonte, de qualquer empresa, que
   * ela não renovou, isto é, o que o IBAMA deixou de listar (e os `NOT_FOUND` e
   * `UNKNOWN` de antes). Chame só depois de **todos** os recursos da fonte terem
   * sido carregados: com um deles faltando, evidências válidas dele seriam
   * removidas. Devolve quantas removeu.
   */
  finish(): Promise<{ removed: number }>;
}

export interface OpenEvidenceBatchInput {
  /** Identificador da fonte no catálogo (ex.: `IBAMA`). */
  sourceSlug: string;

  /**
   * Instante da carga. É a data de coleta de tudo o que ela grava e o corte do
   * que `finish` remove; use o início da execução.
   */
  collectedAt: Date;

  /** Execução de ingestão (`ingestion_runs`) a que os registros brutos pertencem. */
  ingestionRunId?: string;
}
