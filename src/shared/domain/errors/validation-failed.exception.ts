import { HttpStatus } from '@nestjs/common';
import { DomainException } from './domain.exception.js';

/**
 * Problema de validação em um campo da entrada.
 */
export interface ValidationIssue {
  /** Caminho do campo inválido, em notação de ponto (ex.: `address.uf`). */
  path: string;
  /** Descrição do problema. */
  message: string;
}

/**
 * Entrada da requisição (body, query ou params) não atende ao schema do endpoint.
 */
export class ValidationFailedException extends DomainException {
  constructor(issues: ValidationIssue[]) {
    super(
      'VALIDATION_FAILED',
      'Os dados enviados são inválidos.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      issues,
    );
  }
}
