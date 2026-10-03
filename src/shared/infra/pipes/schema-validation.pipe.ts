import {
  Injectable,
  StandardSchemaValidationPipe,
  type StandardSchemaValidationPipeOptions,
} from '@nestjs/common';
import {
  ValidationFailedException,
  type ValidationIssue,
} from '../../domain/errors/validation-failed.exception.js';

type SchemaIssue = Parameters<
  NonNullable<StandardSchemaValidationPipeOptions['exceptionFactory']>
>[0][number];

/**
 * Pipe global de validação de entrada.
 *
 * Estende o pipe nativo de Standard Schema do Nest (compatível com Zod) para
 * que toda falha de validação produza uma `ValidationFailedException` (422),
 * com a lista de campos inválidos no corpo de erro padronizado.
 *
 * Os schemas são declarados nos próprios parâmetros do controller:
 * `@Body({ schema: CreateUserRequestSchema })`.
 */
@Injectable()
export class SchemaValidationPipe extends StandardSchemaValidationPipe {
  constructor() {
    super({
      exceptionFactory: (issues) =>
        new ValidationFailedException(issues.map(toValidationIssue)),
    });
  }
}

function toValidationIssue(issue: SchemaIssue): ValidationIssue {
  const path = (issue.path ?? [])
    .map((segment) =>
      typeof segment === 'object' ? String(segment.key) : String(segment),
    )
    .join('.');

  return { path, message: issue.message };
}
