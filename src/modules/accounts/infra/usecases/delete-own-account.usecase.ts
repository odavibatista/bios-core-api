import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { PasswordProvider } from '@shared/domain/providers/password.provider.js';
import { AccountNotFoundException } from '../../domain/dtos/errors/account-not-found.exception.js';
import { InvalidCurrentPasswordException } from '../../domain/dtos/errors/invalid-current-password.exception.js';
import { UserRepository } from '../../domain/dtos/repositories/user.repository.js';
import type { DeleteAccountRequest } from '../../domain/dtos/requests/account-management.dto.js';

/** Quem exclui a conta e a senha com que confirma. */
export interface DeleteOwnAccountCommand {
  user: AuthenticatedUser;
  request: DeleteAccountRequest;
}

/**
 * Exclui a própria conta, confirmada com a senha (UC05, fluxo 1.2, RF27).
 *
 * Atende ao direito de eliminação do titular (LGPD, NFSE02): a conta e o que
 * depende dela são removidos — sessões, tokens, chaves de API e bloqueios —, os
 * registros de e-mails enviados a ele são apagados, e as tentativas de login
 * ficam só com IP e data/hora, desvinculadas do titular. Não há remoção lógica.
 *
 * As sessões saem junto, então o access token usado nesta requisição já não
 * vale na seguinte, sem esperar o vencimento.
 *
 * @throws {InvalidCurrentPasswordException} quando a senha não confere.
 * @throws {AccountNotFoundException} quando a conta já não existe.
 */
@Injectable()
export class DeleteOwnAccountUseCase extends UseCase<
  DeleteOwnAccountCommand,
  void
> {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordProvider: PasswordProvider,
  ) {
    super();
  }

  override async execute({
    user,
    request,
  }: DeleteOwnAccountCommand): Promise<void> {
    const secrets = await this.userRepository.findSecretsById(user.userId);

    if (!secrets) throw new AccountNotFoundException();

    const passwordMatches = await this.passwordProvider.verify(
      request.password,
      {
        ciphertext: secrets.passwordEncrypted,
        keyVersion: secrets.encryptionKeyVersion,
      },
    );

    if (!passwordMatches) throw new InvalidCurrentPasswordException();

    if (!(await this.userRepository.delete(user.userId))) {
      throw new AccountNotFoundException();
    }
  }
}
