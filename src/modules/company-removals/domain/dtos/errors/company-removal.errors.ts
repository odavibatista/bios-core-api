import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/** O CNPJ não está na lista de cadastros retirados. */
export class CompanyRemovalNotFoundException extends DomainException {
  constructor() {
    super(
      'COMPANY_REMOVAL_NOT_FOUND',
      'CNPJ não encontrado na lista de cadastros retirados.',
      HttpStatus.NOT_FOUND,
    );
  }
}
