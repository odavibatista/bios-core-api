import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * A chamada à API pública não traz uma chave de API válida (UC12).
 *
 * Cobre chave ausente, malformada, desconhecida, com segredo errado e revogada,
 * com a mesma resposta: dizer qual deles ocorreu ajudaria só a quem testa
 * chaves, e distinguir "revogada" de "inexistente" confirmaria que um
 * identificador existiu.
 */
export class InvalidApiKeyException extends DomainException {
  constructor() {
    super(
      'INVALID_API_KEY',
      'Chave de API ausente, inválida ou revogada.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
