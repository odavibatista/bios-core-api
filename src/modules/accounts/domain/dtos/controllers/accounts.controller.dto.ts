import type { AccountMessageResponse } from '../requests/account-message.dto.js';
import type {
  ConfirmEmailRequest,
  ResendEmailConfirmationRequest,
} from '../requests/email-confirmation.dto.js';
import type { RegisterUserRequest } from '../requests/register-user.dto.js';

/**
 * Contrato do controller de contas.
 */
export interface AccountsControllerInterface {
  register(body: RegisterUserRequest): Promise<AccountMessageResponse>;
  confirmEmail(body: ConfirmEmailRequest): Promise<AccountMessageResponse>;
  resendEmailConfirmation(
    body: ResendEmailConfirmationRequest,
  ): Promise<AccountMessageResponse>;
}
