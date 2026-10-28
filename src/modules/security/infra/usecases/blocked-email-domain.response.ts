import type { BlockedEmailDomain } from '../../domain/dtos/requests/blocked-email-domain.dto.js';
import type { BlockedEmailDomainRecord } from '../../domain/dtos/repositories/blocked-email-domain.repository.js';

/** Domínio da blacklist no formato da API. */
export function toBlockedEmailDomainResponse(
  record: BlockedEmailDomainRecord,
): BlockedEmailDomain {
  return {
    id: record.id,
    domain: record.domain,
    origin: record.origin,
    created_at: record.createdAt.toISOString(),
  };
}
