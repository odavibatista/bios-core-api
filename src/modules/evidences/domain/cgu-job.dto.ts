import { z } from 'zod';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
export const FETCH_CGU_EVIDENCES_JOB = 'fetch-cgu-evidences';
export const CguJobSchema = z
  .object({ cnpj: z.string().refine((v) => parseCnpj(v) === v) })
  .strict();
export function cguJobId(cnpj: string, now: Date) {
  return `cgu-${cnpj}-${Math.floor(now.getTime() / 900000)}`;
}
