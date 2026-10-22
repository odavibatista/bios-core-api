import { z } from 'zod';
import { EvidenceState } from '@prisma/client';
import type { StoredEvidence } from './dtos/repositories/evidence.repository.js';

/** Link público absoluto HTTPS; credenciais embutidas não pertencem à auditoria. */
export const EvidenceSourceUrlSchema = z
  .url({ protocol: /^https$/ })
  .regex(/^https:\/\//)
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return !url.username && !url.password;
  }, 'O link da fonte não pode conter credenciais.')
  .meta({ format: 'uri' });

/** Projeta legado sem inventar links nem alterar a evidência guardada. */
export function projectEvidenceProvenance(evidence: StoredEvidence) {
  const sourceReference = evidence.sourceReference?.trim() || null;
  const parsedUrl = EvidenceSourceUrlSchema.safeParse(evidence.sourceUrl);
  const sourceUrl = parsedUrl.success ? parsedUrl.data : null;
  const untraceable =
    evidence.state === EvidenceState.CONFIRMED &&
    !sourceReference &&
    !sourceUrl;
  return {
    sourceReference,
    sourceUrl,
    state: untraceable ? EvidenceState.UNKNOWN : evidence.state,
    summary: untraceable ? null : evidence.summary,
    details: untraceable ? null : evidence.details,
  };
}
