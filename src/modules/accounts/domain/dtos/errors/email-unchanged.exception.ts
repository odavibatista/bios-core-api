import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/** O e-mail informado já é o da própria conta (UC05). */
export class EmailUnchangedException extends DomainException {
  constructor() {
    super(
      'EMAIL_UNCHANGED',
      'O novo e-mail é igual ao atual.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
