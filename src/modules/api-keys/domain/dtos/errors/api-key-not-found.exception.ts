import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * A chave de API não existe, já foi revogada ou não é do usuário (UC11, fluxo 2.1).
 *
 * Os três casos têm a mesma resposta: dizer que a chave é de outra pessoa
 * revelaria a existência de chaves alheias a quem tenta identificadores.
 */
export class ApiKeyNotFoundException extends DomainException {
  constructor() {
    super(
      'API_KEY_NOT_FOUND',
      'Chave de API não encontrada.',
      HttpStatus.NOT_FOUND,
    );
  }
}
