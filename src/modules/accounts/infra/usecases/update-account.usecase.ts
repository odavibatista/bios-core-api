import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import {
  type EncryptedValue,
  EncryptionProvider,
} from '@shared/domain/providers/encryption.provider.js';
import { serializeAddress } from '../../domain/address.js';
import {
  UserRepository,
  type UserUpdate,
  UserUpdateOutcome,
} from '../../domain/dtos/repositories/user.repository.js';
import type { Address } from '../../domain/dtos/requests/address.dto.js';

/** O que mudar na conta. Campo ausente não é alterado. */
export interface AccountChanges {
  name?: string;

  /** Hash da senha nova, já cifrado com a chave ativa (`PasswordProvider.hash`). */
  password?: EncryptedValue;

  /** Novo e-mail, normalizado e em claro. */
  email?: string;

  /** Novo endereço; `null` remove o endereço da conta. */
  address?: Address | null;
}

/**
 * Grava alterações na conta mantendo os campos cifrados coerentes (RF24-RF26).
 *
 * **O documento tem uma única versão de chave** para e-mail, endereço e senha.
 * Quando a chave ativa é mais nova que a do documento, gravar só o campo
 * alterado com a chave nova, e registrar a versão nova, deixaria os demais
 * campos ilegíveis. Por isso, nesse caso, todos os campos cifrados são
 * recifrados na mesma gravação: os alterados com o valor novo, os demais com o
 * valor atual. Quando a versão já é a ativa, só o que mudou é regravado.
 *
 * Todo fluxo que escreve campo cifrado da conta passa por aqui, em vez de
 * repetir essa regra.
 *
 * Devolve `NOT_FOUND` se a conta não existe mais e `EMAIL_TAKEN` se o novo
 * e-mail pertence a outra conta; nesses casos nada é alterado.
 */
@Injectable()
export class UpdateAccountUseCase extends UseCase<
  { userId: string; changes: AccountChanges },
  UserUpdateOutcome
> {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly encryptionProvider: EncryptionProvider,
  ) {
    super();
  }

  override async execute({
    userId,
    changes,
  }: {
    userId: string;
    changes: AccountChanges;
  }): Promise<UserUpdateOutcome> {
    const secrets = await this.userRepository.findSecretsById(userId);

    if (!secrets) return UserUpdateOutcome.NOT_FOUND;

    const activeVersion = this.encryptionProvider.activeKeyVersion;
    const rewrap = secrets.encryptionKeyVersion !== activeVersion;
    const update: UserUpdate = {};

    if (changes.name !== undefined) update.name = changes.name;

    if (changes.password) {
      if (changes.password.keyVersion !== activeVersion) {
        // O hash vem do `PasswordProvider`, que cifra com a chave ativa; outra
        // versão aqui é defeito de quem chamou, e gravá-la corromperia o documento.
        throw new Error(
          `A senha chegou cifrada com a versão ${changes.password.keyVersion} da chave, mas a ativa é a ${activeVersion}.`,
        );
      }

      update.passwordEncrypted = changes.password.ciphertext;
      update.passwordChangedAt = new Date();
    } else if (rewrap) {
      update.passwordEncrypted = this.reencrypt(
        secrets.passwordEncrypted,
        secrets.encryptionKeyVersion,
      );
    }

    if (changes.email !== undefined) {
      update.emailEncrypted = this.encryptionProvider.encrypt(
        changes.email,
      ).ciphertext;
      update.emailHash = this.encryptionProvider.blindIndex(changes.email);
      update.emailConfirmedAt = new Date();
    } else if (rewrap) {
      update.emailEncrypted = this.reencrypt(
        secrets.emailEncrypted,
        secrets.encryptionKeyVersion,
      );
    }

    if (changes.address !== undefined) {
      update.addressEncrypted =
        changes.address === null
          ? null
          : this.encryptionProvider.encrypt(serializeAddress(changes.address))
              .ciphertext;
    } else if (rewrap && secrets.addressEncrypted !== null) {
      update.addressEncrypted = this.reencrypt(
        secrets.addressEncrypted,
        secrets.encryptionKeyVersion,
      );
    }

    if (rewrap) update.encryptionKeyVersion = activeVersion;

    return this.userRepository.update(userId, update);
  }

  /** Decifra com a versão antiga e cifra de novo com a chave ativa. */
  private reencrypt(ciphertext: string, keyVersion: number): string {
    return this.encryptionProvider.encrypt(
      this.encryptionProvider.decrypt({ ciphertext, keyVersion }),
    ).ciphertext;
  }
}
