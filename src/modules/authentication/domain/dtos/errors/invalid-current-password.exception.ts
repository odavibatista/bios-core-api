import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * A senha atual informada na troca de senha está incorreta (UC04, fluxo 3.1).
 *
 * Exigir a senha atual é o que impede que quem apenas tem uma sessão aberta —
 * um computador deixado logado, um access token roubado — assuma a conta.
 */
export class InvalidCurrentPasswordException extends DomainException {
  constructor() {
    super(
      'INVALID_CURRENT_PASSWORD',
      'A senha atual está incorreta.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
