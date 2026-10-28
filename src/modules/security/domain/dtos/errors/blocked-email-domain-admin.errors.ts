import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/** O domínio já está na blacklist (UC13, fluxo 4.1). */
export class BlockedEmailDomainAlreadyExistsException extends DomainException {
  constructor() {
    super(
      'BLOCKED_EMAIL_DOMAIN_ALREADY_EXISTS',
      'Este domínio já está na blacklist.',
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * O domínio não existe na blacklist ou já foi removido (UC13, fluxo 3.1): os dois casos
 * têm a mesma resposta, como o identificador malformado.
 */
export class BlockedEmailDomainNotFoundException extends DomainException {
  constructor() {
    super(
      'BLOCKED_EMAIL_DOMAIN_NOT_FOUND',
      'Domínio não encontrado na blacklist.',
      HttpStatus.NOT_FOUND,
    );
  }
}
