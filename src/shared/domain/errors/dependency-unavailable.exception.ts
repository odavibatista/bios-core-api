import { HttpStatus } from '@nestjs/common';
import { DomainException } from './domain.exception.js';

/**
 * Uma dependência de infraestrutura (banco, fila, fonte externa) está indisponível.
 */
export class DependencyUnavailableException extends DomainException {
  constructor(dependency: string) {
    super(
      'DEPENDENCY_UNAVAILABLE',
      `Dependência indisponível: ${dependency}.`,
      HttpStatus.SERVICE_UNAVAILABLE,
      { dependency },
    );
  }
}
