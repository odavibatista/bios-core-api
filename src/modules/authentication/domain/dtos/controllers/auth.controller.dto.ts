import type { LoginRequest, LoginResponse } from '../requests/login.dto.js';

/**
 * Contrato do controller de autenticação.
 */
export interface AuthControllerInterface {
  login(
    body: LoginRequest,
    ip: string,
    userAgent: string | undefined,
  ): Promise<LoginResponse>;
}
