import { Injectable } from '@nestjs/common';
import { SessionRevocationReason } from '@prisma/client';
import { UserRepository } from '@modules/accounts/domain/dtos/repositories/user.repository.js';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { PasswordProvider } from '@shared/domain/providers/password.provider.js';
import { InvalidCurrentPasswordException } from '../../domain/dtos/errors/invalid-current-password.exception.js';
import { NotAuthenticatedException } from '../../domain/dtos/errors/not-authenticated.exception.js';
import { PasswordUnchangedException } from '../../domain/dtos/errors/password-unchanged.exception.js';
import { ReplacePasswordUseCase } from './replace-password.usecase.js';

/** Quem troca a senha e as duas senhas informadas. */
export interface ChangePasswordCommand {
  user: AuthenticatedUser;
  currentPassword: string;
  newPassword: string;
}

/**
 * Troca a senha do usuário autenticado, exigindo a senha atual (UC04, RF24).
 *
 * Ao concluir, todas as sessões do usuário são revogadas — inclusive a que
 * fez o pedido — e ele precisa entrar de novo com a senha nova.
 *
 * @throws {InvalidCurrentPasswordException} quando a senha atual não confere.
 * @throws {PasswordUnchangedException} quando a nova é igual à atual.
 */
@Injectable()
export class ChangePasswordUseCase extends UseCase<
  ChangePasswordCommand,
  void
> {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordProvider: PasswordProvider,
    private readonly replacePasswordUseCase: ReplacePasswordUseCase,
  ) {
    super();
  }

  override async execute({
    user,
    currentPassword,
    newPassword,
  }: ChangePasswordCommand): Promise<void> {
    const secrets = await this.userRepository.findSecretsById(user.userId);

    if (!secrets) throw new NotAuthenticatedException();

    const stored = {
      ciphertext: secrets.passwordEncrypted,
      keyVersion: secrets.encryptionKeyVersion,
    };

    if (!(await this.passwordProvider.verify(currentPassword, stored))) {
      throw new InvalidCurrentPasswordException();
    }

    if (await this.passwordProvider.verify(newPassword, stored)) {
      throw new PasswordUnchangedException();
    }

    await this.replacePasswordUseCase.execute({
      userId: user.userId,
      newPassword,
      reason: SessionRevocationReason.PASSWORD_CHANGE,
    });
  }
}
