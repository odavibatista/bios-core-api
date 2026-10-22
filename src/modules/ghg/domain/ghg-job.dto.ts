import { z } from 'zod';
export const FETCH_GHG_INVENTORY_JOB = 'fetch-ghg-inventory';
export const GhgJobSchema = z.object({ cnpj: z.string() }).strict();
export type GhgJobResult = { status: 'FOUND' | 'UNKNOWN' };
/** Uma publicacao por CNPJ/janela, sem identificadores pessoais. */
export function ghgJobId(cnpj: string, now: Date) {
  return `ghg-${cnpj}-${Math.floor(now.getTime() / 900000)}`;
}
