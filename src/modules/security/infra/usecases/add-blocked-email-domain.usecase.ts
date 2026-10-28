import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { BlockedEmailDomainAlreadyExistsException } from '../../domain/dtos/errors/blocked-email-domain-admin.errors.js';
import type {
  AddBlockedEmailDomainRequest,
  BlockedEmailDomain,
} from '../../domain/dtos/requests/blocked-email-domain.dto.js';
import { BlockedEmailDomainRepository } from '../../domain/dtos/repositories/blocked-email-domain.repository.js';
import { toBlockedEmailDomainResponse } from './blocked-email-domain.response.js';

/** Quem inclui e qual domínio (já validado e em minúsculas pelo schema de entrada). */
export interface AddBlockedEmailDomainCommand {
  user: AuthenticatedUser;
  request: AddBlockedEmailDomainRequest;
}

/**
 * Inclui um domínio na blacklist (UC13, fluxos 3 e 4), com efeito imediato: o cadastro
 * consulta o banco a cada vez (`CheckEmailDomainAllowedUseCase`), sem cache.
 *
 * Domínio removido antes é restaurado, e não duplicado (RF29), em nome do administrador.
 * Domínio já bloqueado responde `409` (fluxo 4.1). A inclusão vale para cadastros e trocas
 * de e-mail seguintes; contas existentes não são afetadas (regra de negócio 3).
 */
@Injectable()
export class AddBlockedEmailDomainUseCase extends UseCase<
  AddBlockedEmailDomainCommand,
  BlockedEmailDomain
> {
  constructor(private readonly repository: BlockedEmailDomainRepository) {
    super();
  }

  override async execute({
    user,
    request,
  }: AddBlockedEmailDomainCommand): Promise<BlockedEmailDomain> {
    const result = await this.repository.add(request.domain, user.userId);

    if (result.outcome === 'ALREADY_BLOCKED') {
      throw new BlockedEmailDomainAlreadyExistsException();
    }

    return toBlockedEmailDomainResponse(result.record);
  }
}
