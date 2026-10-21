import { z } from 'zod';
import { UNKNOWN_RETRY_WINDOW_SECONDS } from '@modules/evidences/domain/evidence-rules.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';

/** Coleta restrita a uma empresa, na mesma fila do lote diário (UC14, fluxo 1.1). */
export const INGEST_IBAMA_COMPANY_JOB = 'ingest-ibama-company';

export const IbamaCompanyJobPayloadSchema = z.object({
  cnpj: z
    .string()
    .refine(
      (value) => parseCnpj(value) === value,
      'CNPJ deve ser canônico e válido.',
    ),
});
export type IbamaCompanyJobPayload = z.infer<
  typeof IbamaCompanyJobPayloadSchema
>;

export interface IbamaCompanyJobResult {
  outcome: 'SUCCEEDED';
  ingestionRunId: string;
  cnpj: string;
  dumpChecksum: string;
  recordsRead: number;
  recordsUpserted: number;
  recordsDiscarded: number;
  removed: number;
}

/**
 * Uma publicação por CNPJ por janela curta. A janela permite tentar novamente
 * depois de um job falho, que o BullMQ mantém para diagnóstico.
 */
export function ibamaCompanyJobId(cnpj: string, now = new Date()): string {
  const window = Math.floor(
    now.getTime() / (UNKNOWN_RETRY_WINDOW_SECONDS * 1000),
  );
  return `ibama-cnpj-${cnpj}-${window}`;
}
