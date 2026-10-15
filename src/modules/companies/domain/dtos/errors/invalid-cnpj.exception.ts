import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/** O CNPJ informado não tem formato ou dígitos verificadores válidos (UC06, fluxo 2.1). */
export class InvalidCnpjException extends DomainException {
  constructor() {
    super(
      'INVALID_CNPJ',
      'CNPJ inválido. Confira os dígitos e tente de novo.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
