import { Injectable } from '@nestjs/common';
import { EmailDomainPolicyProvider } from '@modules/security/domain/providers/email-domain-policy.provider.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { PasswordProvider } from '@shared/domain/providers/password.provider.js';
import { normalizeEmail } from '@shared/domain/value-objects/email-address.js';
import { UserRepository } from '../../domain/dtos/repositories/user.repository.js';
import type { RegisterUserRequest } from '../../domain/dtos/requests/register-user.dto.js';
import { SendEmailConfirmationUseCase } from './send-email-confirmation.usecase.js';

/**
 * Cadastra uma conta inativa e envia o link de confirmação (UC01, RF01).
 *
 * **Não revela se o e-mail já tem conta.** Quando tem, o caso de uso termina
 * sem erro e sem enviar nada, e o chamador exibe a mesma mensagem de sucesso
 * (fluxo 2.2). Para que a resposta também não denuncie a conta pelo tempo, o
 * hash da senha — a parte cara — roda antes de saber se o e-mail existe,
 * igualando os dois caminhos.
 *
 * O e-mail e o endereço ficam cifrados e a senha em duas camadas (NFSE03); o
 * e-mail em claro só existe aqui, para o envio.
 *
 * @throws {BlockedEmailDomainException} quando o domínio do e-mail está na
 * blacklist (fluxo 2.1).
 */
@Injectable()
export class RegisterUserUseCase extends UseCase<RegisterUserRequest, void> {
  constructor(
    private readonly emailDomainPolicyProvider: EmailDomainPolicyProvider,
    private readonly passwordProvider: PasswordProvider,
    private readonly encryptionProvider: EncryptionProvider,
    private readonly userRepository: UserRepository,
    private readonly sendEmailConfirmationUseCase: SendEmailConfirmationUseCase,
  ) {
    super();
  }

  override async execute({
    name,
    email,
    password,
  }: RegisterUserRequest): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    const displayName = name.trim();

    await this.emailDomainPolicyProvider.execute(normalizedEmail);

    const passwordEncrypted = await this.passwordProvider.hash(password);
    const emailEncrypted = this.encryptionProvider.encrypt(normalizedEmail);

    const userId = await this.userRepository.createInactive({
      name: displayName,
      emailEncrypted: emailEncrypted.ciphertext,
      emailHash: this.encryptionProvider.blindIndex(normalizedEmail),
      passwordEncrypted: passwordEncrypted.ciphertext,
      // Os dois valores saem da mesma chave ativa: um único campo no documento.
      encryptionKeyVersion: emailEncrypted.keyVersion,
    });

    if (userId === null) return;

    await this.sendEmailConfirmationUseCase.execute({
      userId,
      name: displayName,
      email: normalizedEmail,
    });
  }
}
