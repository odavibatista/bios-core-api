import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { AccountNotFoundException } from '../../domain/dtos/errors/account-not-found.exception.js';
import { UserUpdateOutcome } from '../../domain/dtos/repositories/user.repository.js';
import type {
  AccountResponse,
  UpdateAccountRequest,
} from '../../domain/dtos/requests/account-management.dto.js';
import { GetOwnAccountUseCase } from './get-own-account.usecase.js';
import { UpdateAccountUseCase } from './update-account.usecase.js';

/** Quem edita e o que muda. */
export interface UpdateOwnAccountCommand extends UpdateAccountRequest {
  userId: string;
}

/**
 * Edita o nome e/ou o endereço da própria conta (UC05, RF26).
 *
 * O e-mail não passa por aqui: a troca exige confirmação no novo endereço e
 * tem fluxo próprio. Devolve a conta já atualizada.
 *
 * @throws {AccountNotFoundException} quando a conta já não existe.
 */
@Injectable()
export class UpdateOwnAccountUseCase extends UseCase<
  UpdateOwnAccountCommand,
  AccountResponse
> {
  constructor(
    private readonly updateAccountUseCase: UpdateAccountUseCase,
    private readonly getOwnAccountUseCase: GetOwnAccountUseCase,
  ) {
    super();
  }

  override async execute({
    userId,
    name,
    address,
  }: UpdateOwnAccountCommand): Promise<AccountResponse> {
    const outcome = await this.updateAccountUseCase.execute({
      userId,
      changes: { name, address },
    });

    if (outcome !== UserUpdateOutcome.UPDATED) {
      throw new AccountNotFoundException();
    }

    return this.getOwnAccountUseCase.execute(userId);
  }
}
