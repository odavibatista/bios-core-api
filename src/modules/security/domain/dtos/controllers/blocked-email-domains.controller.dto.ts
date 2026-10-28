import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import type {
  AddBlockedEmailDomainRequest,
  BlockedEmailDomain,
  BlockedEmailDomainListResponse,
  ListBlockedEmailDomainsQuery,
} from '../requests/blocked-email-domain.dto.js';

/**
 * Contrato do controller de manutenção da blacklist de domínios (UC13).
 */
export interface BlockedEmailDomainsControllerInterface {
  list(
    query: ListBlockedEmailDomainsQuery,
  ): Promise<BlockedEmailDomainListResponse>;
  add(
    body: AddBlockedEmailDomainRequest,
    user: AuthenticatedUser,
  ): Promise<BlockedEmailDomain>;
  remove(id: string): Promise<void>;
}
