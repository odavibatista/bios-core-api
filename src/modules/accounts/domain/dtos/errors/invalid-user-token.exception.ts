import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * O link recebido por e-mail não pode ser usado (RF25, RF28).
 *
 * Uma única exceção cobre token desconhecido, expirado, já usado, substituído
 * por um link mais novo ou de outra finalidade. Distingui-los diria a quem
 * tenta adivinhar links quais existem; para o usuário legítimo a ação é a
 * mesma em todos os casos — pedir um novo link.
 */
export class InvalidUserTokenException extends DomainException {
  constructor() {
    super(
      'USER_TOKEN_INVALID',
      'O link é inválido, expirou ou já foi usado. Solicite um novo.',
      HttpStatus.BAD_REQUEST,
    );
  }
}
