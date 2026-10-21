import type { Prisma } from '@prisma/client';

/** Registro bruto de uma fonte, pronto para gravar. */
export interface RawEvidenceToSave {
  dataSourceId: string;

  /** Execução de ingestão que o coletou, quando há (`ingestion_runs`). */
  ingestionRunId: string | null;

  cnpj: string;

  /** Identificador do registro no órgão de origem. */
  externalReference: string;

  /** O registro, já reduzido às colunas permitidas da fonte. */
  payload: Prisma.InputJsonValue;

  /** Resumo do conteúdo: o mesmo registro, na mesma fonte, tem o mesmo resumo. */
  payloadHash: string;

  collectedAt: Date;
}

/**
 * Contrato da camada bruta de evidências (`evidence_raw`), mantida para
 * auditoria (NFCO02).
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class RawEvidenceRepository {
  /**
   * Grava o registro bruto e devolve o seu identificador. O mesmo conteúdo da
   * mesma fonte (`payloadHash`) é gravado uma vez só: coletar de novo devolve o
   * registro que já existe, com a data da primeira coleta.
   */
  abstract save(raw: RawEvidenceToSave): Promise<string>;
}
