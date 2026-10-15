import { Injectable } from '@nestjs/common';
import type { SessionRevocationReason } from '@prisma/client';
import {
  type PasswordUpdate,
  UserRepository,
} from '@modules/accounts/domain/dtos/repositories/user.repository.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { PasswordProvider } from '@shared/domain/providers/password.provider.js';
import { NotAuthenticatedException } from '../../domain/dtos/errors/not-authenticated.exception.js';
import { UserSessionRepository } from '../../domain/dtos/repositories/user-session.repository.js';

/** Conta, senha nova e o motivo com que as sessões serão revogadas. */
export interface ReplacePasswordCommand {
  userId: string;
  newPassword: string;

  /** `PASSWORD_CHANGE` (troca pelo usuário) ou `PASSWORD_RESET` (recuperação). */
  reason: SessionRevocationReason;
}

/**
 * Grava a nova senha e derruba todas as sessões da conta (UC04, RF24, RF25).
 *
 * Reúne o que a troca e a recuperação têm em comum, para que as duas tratem a
 * senha e as sessões do mesmo jeito.
 *
 * **A senha é gravada antes de as sessões serem revogadas.** Na ordem inversa,
 * quem ainda soubesse a senha antiga poderia abrir uma sessão nova entre a
 * revogação e a gravação, e ela sobreviveria. Todas as sessões ativas são
 * revogadas, de todos os dispositivos, inclusive a que originou a troca.
 *
 * **Uma versão de chave por documento.** Se a chave ativa não é a que cifrou o
 * documento, o e-mail e o endereço são recifrados na mesma gravação; do
 * contrário o documento ficaria com campos de versões diferentes sob uma única
 * versão registrada, e o e-mail deixaria de poder ser lido.
 *
 * @throws {NotAuthenticatedException} quando a conta não existe mais.
 */
@Injectable()
export class ReplacePasswordUseCase extends UseCase<
  ReplacePasswordCommand,
  void
> {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly userSessionRepository: UserSessionRepository,
    private readonly passwordProvider: PasswordProvider,
    private readonly encryptionProvider: EncryptionProvider,
  ) {
    super();
  }

  override async execute({
    userId,
    newPassword,
    reason,
  }: ReplacePasswordCommand): Promise<void> {
    const changedAt = new Date();
    const secrets = await this.userRepository.findSecretsById(userId);

    if (!secrets) throw new NotAuthenticatedException();

    const hashed = await this.passwordProvider.hash(newPassword);
    const update: PasswordUpdate = {
      passwordEncrypted: hashed.ciphertext,
      encryptionKeyVersion: hashed.keyVersion,
      changedAt,
    };

    if (secrets.encryptionKeyVersion !== hashed.keyVersion) {
      update.emailEncrypted = this.reencrypt(
        secrets.emailEncrypted,
        secrets.encryptionKeyVersion,
      );

      if (secrets.addressEncrypted !== null) {
        update.addressEncrypted = this.reencrypt(
          secrets.addressEncrypted,
          secrets.encryptionKeyVersion,
        );
      }
    }

    if (!(await this.userRepository.updatePassword(userId, update))) {
      throw new NotAuthenticatedException();
    }

    await this.userSessionRepository.revokeAllActive(userId, reason, changedAt);
  }

  /** Decifra com a versão antiga e cifra de novo com a chave ativa. */
  private reencrypt(ciphertext: string, keyVersion: number): string {
    return this.encryptionProvider.encrypt(
      this.encryptionProvider.decrypt({ ciphertext, keyVersion }),
    ).ciphertext;
  }
}
