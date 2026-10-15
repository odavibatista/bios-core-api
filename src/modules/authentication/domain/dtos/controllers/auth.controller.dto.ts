import type { LoginRequest } from '../requests/login.dto.js';
import type { RefreshSessionRequest } from '../requests/refresh-session.dto.js';
import type { SessionResponse } from '../requests/session.dto.js';

/**
 * Contrato do controller de autenticação.
 */
export interface AuthControllerInterface {
  login(
    body: LoginRequest,
    ip: string,
    userAgent: string | undefined,
  ): Promise<SessionResponse>;
  refresh(
    body: RefreshSessionRequest,
    ip: string,
    userAgent: string | undefined,
  ): Promise<SessionResponse>;
}
