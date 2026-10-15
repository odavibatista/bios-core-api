import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * A senha confere, mas a conta ainda não teve o e-mail confirmado (UC01, regra
 * de negócio 1).
 *
 * Só é dita a quem acertou a senha, então não revela a existência da conta a
 * quem apenas tenta e-mails: o front-end pode oferecer o reenvio do link.
 */
export class AccountNotConfirmedException extends DomainException {
  constructor() {
    super(
      'ACCOUNT_NOT_CONFIRMED',
      'Confirme seu e-mail para acessar. Se precisar, solicite um novo link.',
      HttpStatus.FORBIDDEN,
    );
  }
}
