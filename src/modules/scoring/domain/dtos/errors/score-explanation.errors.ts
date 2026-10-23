import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

export class ScoreNotFoundException extends DomainException {
  constructor() {
    super(
      'SCORE_NOT_FOUND',
      'Índice não calculado para a empresa e o ODS informados.',
      HttpStatus.NOT_FOUND,
    );
  }
}

/** A referência do retrato deixou de apontar para uma evidência auditável. */
export class ScoreExplanationStaleException extends DomainException {
  constructor() {
    super(
      'SCORE_EXPLANATION_STALE',
      'O índice precisa ser recalculado antes de exibir sua explicação.',
      HttpStatus.CONFLICT,
    );
  }
}
