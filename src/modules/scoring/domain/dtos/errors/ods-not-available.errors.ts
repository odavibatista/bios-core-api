import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * O ODS informado não é calculado pelo BIOS (inexistente ou desativado): pesquisar por ele
 * devolveria lista vazia ou valores nulos, que não se distinguem de "nenhuma empresa atende".
 */
export class OdsNotAvailableException extends DomainException {
  constructor(ods: number, validOds: readonly number[]) {
    super(
      'ODS_NOT_AVAILABLE',
      `O ODS ${ods} não é calculado pelo BIOS. ODS disponíveis: ${validOds.join(', ') || 'nenhum'}.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      { ods, valid_ods: validOds },
    );
  }
}
