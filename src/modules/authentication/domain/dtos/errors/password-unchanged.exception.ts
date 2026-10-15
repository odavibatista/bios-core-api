import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * A senha nova é igual à atual (UC04).
 *
 * A troca existe para tirar a senha antiga de circulação; aceitar a mesma
 * revogaria as sessões sem mudar nada.
 */
export class PasswordUnchangedException extends DomainException {
  constructor() {
    super(
      'PASSWORD_UNCHANGED',
      'A nova senha deve ser diferente da atual.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
