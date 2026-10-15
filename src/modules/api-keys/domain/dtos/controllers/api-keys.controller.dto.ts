import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import type {
  ApiKeyListResponse,
  CreateApiKeyRequest,
  CreatedApiKeyResponse,
} from '../requests/api-key.dto.js';

/**
 * Contrato do controller de chaves de API.
 */
export interface ApiKeysControllerInterface {
  create(
    body: CreateApiKeyRequest,
    user: AuthenticatedUser,
  ): Promise<CreatedApiKeyResponse>;
  list(user: AuthenticatedUser): Promise<ApiKeyListResponse>;
  revoke(apiKeyId: string, user: AuthenticatedUser): Promise<void>;
}
