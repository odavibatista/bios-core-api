import { Injectable } from '@nestjs/common';
import { EmailTemplate, UserTokenPurpose } from '@prisma/client';
import { SendTransactionalEmailUseCase } from '@modules/mailing/infra/usecases/send-transactional-email.usecase.js';
import { EmailDomainPolicyProvider } from '@modules/security/domain/providers/email-domain-policy.provider.js';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { PasswordProvider } from '@shared/domain/providers/password.provider.js';
import {
  firstNameOf,
  normalizeEmail,
} from '@shared/domain/value-objects/email-address.js';
import { encodePendingEmail } from '../../domain/pending-email.js';
import { AccountNotFoundException } from '../../domain/dtos/errors/account-not-found.exception.js';
import { EmailUnchangedException } from '../../domain/dtos/errors/email-unchanged.exception.js';
import { InvalidCurrentPasswordException } from '../../domain/dtos/errors/invalid-current-password.exception.js';
import { UserRepository } from '../../domain/dtos/repositories/user.repository.js';
import type { ChangeEmailRequest } from '../../domain/dtos/requests/account-management.dto.js';
import { IssueUserTokenUseCase } from './issue-user-token.usecase.js';

/** Quem pede a troca e o que informou. */
export interface RequestEmailChangeCommand {
  user: AuthenticatedUser;
  request: ChangeEmailRequest;
}

/**
 * Pede a troca do e-mail da conta, enviando o link de confirmação ao **novo**
 * endereço (UC05, fluxo 1.1, RF26, RF28).
 *
 * O e-mail atual continua valendo até o link ser aberto: só então a troca é
 * efetivada (`ConfirmEmailChangeUseCase`). O novo e-mail fica cifrado no token,
 * com a versão da chave que o cifrou.
 *
 * - Exige a senha atual, porque o e-mail é o canal de recuperação da conta.
 * - Recusa domínios da blacklist (RF22), como o cadastro.
 * - **Não revela se o novo e-mail já pertence a outra conta**: nesse caso
 *   termina sem erro e sem enviar nada, e a resposta é a mesma do sucesso. A
 *   única exceção é o e-mail da própria conta, que ninguém mais conhece.
 * - Pedir outra troca invalida o link anterior.
 *
 * @throws {InvalidCurrentPasswordException} quando a senha atual não confere.
 * @throws {EmailUnchangedException} quando o novo e-mail é o da própria conta.
 * @throws {BlockedEmailDomainException} quando o domínio está na blacklist.
 * @throws {AccountNotFoundException} quando a conta já não existe.
 */
@Injectable()
export class RequestEmailChangeUseCase extends UseCase<
  RequestEmailChangeCommand,
  void
> {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordProvider: PasswordProvider,
    private readonly encryptionProvider: EncryptionProvider,
    private readonly emailDomainPolicyProvider: EmailDomainPolicyProvider,
    private readonly issueUserTokenUseCase: IssueUserTokenUseCase,
    private readonly sendTransactionalEmailUseCase: SendTransactionalEmailUseCase,
  ) {
    super();
  }

  override async execute({
    user,
    request,
  }: RequestEmailChangeCommand): Promise<void> {
    const secrets = await this.userRepository.findSecretsById(user.userId);

    if (!secrets) throw new AccountNotFoundException();

    const passwordMatches = await this.passwordProvider.verify(
      request.current_password,
      {
        ciphertext: secrets.passwordEncrypted,
        keyVersion: secrets.encryptionKeyVersion,
      },
    );

    if (!passwordMatches) throw new InvalidCurrentPasswordException();

    const newEmail = normalizeEmail(request.new_email);

    await this.emailDomainPolicyProvider.execute(newEmail);

    const owner = await this.userRepository.findByEmailHash(
      this.encryptionProvider.blindIndex(newEmail),
    );

    if (owner?.id === user.userId) throw new EmailUnchangedException();

    // De outra conta: sem erro e sem e-mail, para não revelar que existe.
    if (owner) return;

    const { token, validity } = await this.issueUserTokenUseCase.execute({
      userId: user.userId,
      purpose: UserTokenPurpose.EMAIL_CHANGE,
      pendingEmailEncrypted: encodePendingEmail(
        this.encryptionProvider.encrypt(newEmail),
      ),
    });

    await this.sendTransactionalEmailUseCase.execute({
      template: EmailTemplate.EMAIL_CHANGE_CONFIRMATION,
      to: newEmail,
      context: {
        name: firstNameOf(await this.nameOf(user.userId)),
        token,
        validity,
      },
      userId: user.userId,
    });
  }

  private async nameOf(userId: string): Promise<string> {
    const profile = await this.userRepository.findProfileById(userId);

    if (!profile) throw new AccountNotFoundException();

    return profile.name;
  }
}
