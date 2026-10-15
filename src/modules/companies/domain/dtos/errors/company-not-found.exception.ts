import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/** Nenhuma fonte reconhece o CNPJ (UC06, fluxo 3.3). */
export class CompanyNotFoundException extends DomainException {
  constructor() {
    super(
      'COMPANY_NOT_FOUND',
      'Empresa não encontrada para o CNPJ informado.',
      HttpStatus.NOT_FOUND,
    );
  }
}
