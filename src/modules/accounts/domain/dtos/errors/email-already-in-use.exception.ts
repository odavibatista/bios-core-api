import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * O novo e-mail passou a pertencer a outra conta antes de a troca ser
 * confirmada (UC05, RF26).
 *
 * Só aparece na confirmação, a quem tem o link — e portanto controla a caixa
 * de entrada do novo endereço. O pedido de troca, por sua vez, não revela se o
 * e-mail já está em uso.
 */
export class EmailAlreadyInUseException extends DomainException {
  constructor() {
    super(
      'EMAIL_ALREADY_IN_USE',
      'Este e-mail já está em uso por outra conta.',
      HttpStatus.CONFLICT,
    );
  }
}
