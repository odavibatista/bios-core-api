import { z } from 'zod';
export const FETCH_GHG_INVENTORY_JOB = 'fetch-ghg-inventory';
/** Job diário que sincroniza o cadastro de organizações do portal (fila `ghg-inventory`). */
export const SYNC_GHG_ORGANIZATIONS_JOB = 'sync-ghg-organizations';
export const GhgJobSchema = z.object({ cnpj: z.string() }).strict();
/** O job de sincronização não leva parâmetro: a fonte vem do catálogo. */
export const GhgSyncJobPayloadSchema = z.object({}).strict();
export type GhgJobResult = { status: 'FOUND' | 'UNKNOWN' };
export type GhgSyncJobResult = { organizations: number };
/** Uma publicacao por CNPJ/janela, sem identificadores pessoais. */
export function ghgJobId(cnpj: string, now: Date) {
  return `ghg-${cnpj}-${Math.floor(now.getTime() / 900000)}`;
}
