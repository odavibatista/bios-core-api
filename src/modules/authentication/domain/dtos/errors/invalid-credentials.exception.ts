import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * E-mail ou senha incorretos (UC02, fluxo 3.1).
 *
 * A mensagem não distingue e-mail inexistente de senha errada: dizer qual dos
 * dois falhou entregaria a quem tenta a lista de contas cadastradas.
 */
export class InvalidCredentialsException extends DomainException {
  constructor() {
    super(
      'INVALID_CREDENTIALS',
      'E-mail ou senha incorretos.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
