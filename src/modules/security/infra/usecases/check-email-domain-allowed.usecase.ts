import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { BlockedEmailDomainException } from '../../domain/dtos/errors/blocked-email-domain.exception.js';
import { BlockedEmailDomainRepository } from '../../domain/dtos/repositories/blocked-email-domain.repository.js';
import type { EmailDomainPolicyProvider } from '../../domain/providers/email-domain-policy.provider.js';

/**
 * Domínio de um e-mail, normalizado para comparação exata.
 *
 * Minúsculas e sem espaços nas bordas, como os domínios são gravados. Usa o
 * trecho depois do último `@`: a blacklist compara o domínio inteiro, e não
 * sufixos, de modo que bloquear `mailinator.com` não afeta
 * `naomailinator.com`.
 *
 * Devolve `undefined` para texto sem domínio — e-mail malformado é erro de
 * validação do schema de entrada, não assunto da blacklist.
 */
function domainOf(email: string): string | undefined {
  const [, domain] = /@([^@]+)$/.exec(email.trim().toLowerCase()) ?? [];

  return domain;
}

/**
 * Recusa o cadastro ou a troca de e-mail cujo domínio está na blacklist
 * (RF22).
 *
 * Consulta o banco a cada chamada, de propósito: a lista é editável por
 * administrador (RF29) e a alteração tem de valer na consulta seguinte. Um
 * cache aqui faria um domínio recém-bloqueado continuar passando.
 */
@Injectable()
export class CheckEmailDomainAllowedUseCase
  extends UseCase<string, void>
  implements EmailDomainPolicyProvider
{
  constructor(
    private readonly blockedEmailDomainRepository: BlockedEmailDomainRepository,
  ) {
    super();
  }

  override async execute(email: string): Promise<void> {
    const domain = domainOf(email);

    if (!domain) return;

    if (await this.blockedEmailDomainRepository.isBlocked(domain)) {
      throw new BlockedEmailDomainException();
    }
  }
}
