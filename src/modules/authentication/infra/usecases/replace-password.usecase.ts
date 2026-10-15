import { Injectable } from '@nestjs/common';
import type { SessionRevocationReason } from '@prisma/client';
import { UserUpdateOutcome } from '@modules/accounts/domain/dtos/repositories/user.repository.js';
import { UpdateAccountUseCase } from '@modules/accounts/infra/usecases/update-account.usecase.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
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
 * A coerência dos campos cifrados com a versão da chave é de
 * `UpdateAccountUseCase`.
 *
 * @throws {NotAuthenticatedException} quando a conta não existe mais.
 */
@Injectable()
export class ReplacePasswordUseCase extends UseCase<
  ReplacePasswordCommand,
  void
> {
  constructor(
    private readonly updateAccountUseCase: UpdateAccountUseCase,
    private readonly userSessionRepository: UserSessionRepository,
    private readonly passwordProvider: PasswordProvider,
  ) {
    super();
  }

  override async execute({
    userId,
    newPassword,
    reason,
  }: ReplacePasswordCommand): Promise<void> {
    const hashed = await this.passwordProvider.hash(newPassword);
    const outcome = await this.updateAccountUseCase.execute({
      userId,
      changes: { password: hashed },
    });

    if (outcome !== UserUpdateOutcome.UPDATED) {
      throw new NotAuthenticatedException();
    }

    await this.userSessionRepository.revokeAllActive(
      userId,
      reason,
      new Date(),
    );
  }
}
