import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * A conta do usuário autenticado não existe mais.
 *
 * Só acontece em corrida com a exclusão da conta (outro dispositivo excluindo
 * enquanto este edita): a sessão ainda valia quando a requisição chegou.
 */
export class AccountNotFoundException extends DomainException {
  constructor() {
    super('ACCOUNT_NOT_FOUND', 'Conta não encontrada.', HttpStatus.NOT_FOUND);
  }
}
