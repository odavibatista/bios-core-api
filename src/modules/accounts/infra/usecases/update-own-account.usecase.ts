import { Injectable } from '@nestjs/common';
import { ResolveCityUseCase } from '@modules/locations/infra/usecases/resolve-city.usecase.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { AccountNotFoundException } from '../../domain/dtos/errors/account-not-found.exception.js';
import { UserUpdateOutcome } from '../../domain/dtos/repositories/user.repository.js';
import type {
  AccountResponse,
  UpdateAccountRequest,
} from '../../domain/dtos/requests/account-management.dto.js';
import type { Address } from '../../domain/dtos/requests/address.dto.js';
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
 * tem fluxo próprio. Devolve a conta já atualizada. Município escolhido da lista é conferido na
 * UF do endereço e gravado com o nome do catálogo (RF38).
 *
 * @throws {AccountNotFoundException} quando a conta já não existe.
 * @throws {CityNotInStateException} quando o código não é de um município da UF (422).
 */
@Injectable()
export class UpdateOwnAccountUseCase extends UseCase<
  UpdateOwnAccountCommand,
  AccountResponse
> {
  constructor(
    private readonly updateAccountUseCase: UpdateAccountUseCase,
    private readonly getOwnAccountUseCase: GetOwnAccountUseCase,
    private readonly resolveCity: ResolveCityUseCase,
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
      changes: { name, address: await this.withCatalogCity(address) },
    });

    if (outcome !== UserUpdateOutcome.UPDATED) {
      throw new AccountNotFoundException();
    }

    return this.getOwnAccountUseCase.execute(userId);
  }

  private async withCatalogCity<TAddress extends Address | null | undefined>(
    address: TAddress,
  ): Promise<TAddress> {
    if (!address?.city_ibge_code) return address;

    const city = await this.resolveCity.execute({
      ibgeCode: address.city_ibge_code,
      uf: address.state,
    });

    return { ...address, city: city.name };
  }
}
