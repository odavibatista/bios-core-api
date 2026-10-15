import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * O IP ou a conta está com o acesso bloqueado (RF20, RF21).
 *
 * Informa quanto falta para liberar, para que o front-end possa avisar o
 * usuário legítimo. Bloqueio sem prazo (honeypot) não tem o que informar.
 */
export class AccessBlockedException extends DomainException {
  constructor(retryAfterSeconds: number | null) {
    super(
      'ACCESS_TEMPORARILY_BLOCKED',
      'Acesso temporariamente bloqueado. Tente novamente mais tarde.',
      HttpStatus.TOO_MANY_REQUESTS,
      retryAfterSeconds === null
        ? undefined
        : { retry_after_seconds: retryAfterSeconds },
    );
  }
}
