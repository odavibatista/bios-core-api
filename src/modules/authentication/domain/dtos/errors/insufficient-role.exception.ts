import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * A sessão é válida, mas o papel da conta não dá acesso à rota (11-Permissões): ex.:
 * `USER` na manutenção da blacklist de domínios, exclusiva de `ADMIN` (`[P12]`).
 */
export class InsufficientRoleException extends DomainException {
  constructor() {
    super(
      'INSUFFICIENT_ROLE',
      'Seu perfil de acesso não permite esta operação.',
      HttpStatus.FORBIDDEN,
    );
  }
}
