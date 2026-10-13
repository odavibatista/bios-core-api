import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * O domínio do e-mail informado está na blacklist (RF22).
 *
 * A mensagem é genérica e não há detalhes: revelar que o domínio específico
 * está bloqueado entregaria a lista a quem quer contorná-la, bastando testar
 * endereços até achar um que passe.
 */
export class BlockedEmailDomainException extends DomainException {
  constructor() {
    super(
      'EMAIL_DOMAIN_NOT_ALLOWED',
      'Não é possível usar este endereço de e-mail. Informe outro.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
