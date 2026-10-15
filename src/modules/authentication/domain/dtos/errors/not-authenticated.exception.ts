import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * A requisição não traz uma sessão válida (UC03, NFSE05).
 *
 * Cobre token ausente, malformado, adulterado, expirado e sessão encerrada, com
 * a mesma resposta: dizer qual deles ocorreu ajudaria só a quem testa tokens.
 * Para o front-end a conduta é a mesma em todos — renovar a sessão e, se isso
 * falhar, pedir login.
 */
export class NotAuthenticatedException extends DomainException {
  constructor() {
    super(
      'NOT_AUTHENTICATED',
      'Autenticação necessária. Entre para continuar.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
