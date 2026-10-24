import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/** A pesquisa não tem resultado: não há lista para exportar (UC09, pré-condição). */
export class NoResultsToExportException extends DomainException {
  constructor() {
    super(
      'NO_RESULTS_TO_EXPORT',
      'Nenhuma empresa atende aos critérios informados: não há lista para exportar.',
      HttpStatus.NOT_FOUND,
    );
  }
}

/** A lista passa do limite de uma exportação; é preciso refinar os critérios. */
export class ExportTooLargeException extends DomainException {
  constructor(total: number, max: number) {
    super(
      'EXPORT_TOO_LARGE',
      `A pesquisa tem ${total} empresas e uma exportação aceita até ${max}. Refine os critérios.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      { total, max },
    );
  }
}
