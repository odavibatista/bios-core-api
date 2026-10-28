import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * Indisponibilidade simulada da isca (RF21: baixa disponibilidade proposital). Mesmo código
 * e mesma mensagem da indisponibilidade real dos dados cadastrais: por fora, a isca falha
 * como a API falharia.
 */
export class DecoyUnavailableException extends DomainException {
  constructor() {
    super(
      'COMPANY_DATA_UNAVAILABLE',
      'Os dados cadastrais estão temporariamente indisponíveis. Tente novamente em instantes.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
