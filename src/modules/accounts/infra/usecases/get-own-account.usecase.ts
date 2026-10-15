import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { parseAddress } from '../../domain/address.js';
import { AccountNotFoundException } from '../../domain/dtos/errors/account-not-found.exception.js';
import { UserRepository } from '../../domain/dtos/repositories/user.repository.js';
import type { AccountResponse } from '../../domain/dtos/requests/account-management.dto.js';

/**
 * Devolve os dados da própria conta, com e-mail e endereço decifrados (UC05).
 *
 * Os dados pessoais só existem em claro aqui, na resposta ao próprio titular.
 *
 * @throws {AccountNotFoundException} quando a conta já não existe.
 */
@Injectable()
export class GetOwnAccountUseCase extends UseCase<string, AccountResponse> {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly encryptionProvider: EncryptionProvider,
  ) {
    super();
  }

  override async execute(userId: string): Promise<AccountResponse> {
    const profile = await this.userRepository.findProfileById(userId);

    if (!profile) throw new AccountNotFoundException();

    const keyVersion = profile.encryptionKeyVersion;

    return {
      id: profile.id,
      name: profile.name,
      email: this.encryptionProvider.decrypt({
        ciphertext: profile.emailEncrypted,
        keyVersion,
      }),
      address:
        profile.addressEncrypted === null
          ? null
          : parseAddress(
              this.encryptionProvider.decrypt({
                ciphertext: profile.addressEncrypted,
                keyVersion,
              }),
            ),
      role: profile.role,
    };
  }
}
