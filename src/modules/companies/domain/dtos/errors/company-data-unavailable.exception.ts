import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * Os provedores cadastrais estão indisponíveis e não há cadastro guardado para
 * o CNPJ (UC06, fluxo 3.2, NFCO01).
 *
 * Diferente de "não encontrada": a empresa pode existir, mas não há como saber
 * agora. O cliente deve tentar de novo mais tarde.
 */
export class CompanyDataUnavailableException extends DomainException {
  constructor() {
    super(
      'COMPANY_DATA_UNAVAILABLE',
      'Os dados cadastrais estão temporariamente indisponíveis. Tente novamente em instantes.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
