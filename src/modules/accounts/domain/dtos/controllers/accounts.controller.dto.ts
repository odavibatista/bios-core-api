import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import type {
  AccountResponse,
  ChangeEmailRequest,
  DeleteAccountRequest,
  UpdateAccountRequest,
} from '../requests/account-management.dto.js';
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
  getOwnAccount(user: AuthenticatedUser): Promise<AccountResponse>;
  updateOwnAccount(
    body: UpdateAccountRequest,
    user: AuthenticatedUser,
  ): Promise<AccountResponse>;
  requestEmailChange(
    body: ChangeEmailRequest,
    user: AuthenticatedUser,
  ): Promise<AccountMessageResponse>;
  confirmEmailChange(
    body: ConfirmEmailRequest,
  ): Promise<AccountMessageResponse>;
  deleteOwnAccount(
    body: DeleteAccountRequest,
    user: AuthenticatedUser,
  ): Promise<void>;
  resendEmailConfirmation(
    body: ResendEmailConfirmationRequest,
  ): Promise<AccountMessageResponse>;
}
