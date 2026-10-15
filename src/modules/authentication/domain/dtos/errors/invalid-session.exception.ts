import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * O refresh token não pode ser usado (UC17, RF32).
 *
 * Uma única exceção, com a mesma mensagem, cobre token desconhecido, expirado,
 * revogado e reutilizado. Distingui-los diria a quem apresenta um token roubado
 * se ele foi percebido e se as sessões foram derrubadas; para o usuário
 * legítimo a saída é a mesma em todos os casos: entrar de novo.
 */
export class InvalidSessionException extends DomainException {
  constructor() {
    super(
      'SESSION_INVALID',
      'Sessão inválida ou expirada. Entre novamente.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
