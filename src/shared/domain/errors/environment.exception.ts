import type { z } from 'zod';

/**
 * Configuração de ambiente ausente ou inválida.
 *
 * Lançada no bootstrap, antes de a aplicação aceitar requisições; não é uma
 * exceção HTTP.
 */
export class EnvironmentException extends Error {
  constructor(readonly issues: readonly z.core.$ZodIssue[]) {
    super(
      `Configuração de ambiente inválida:\n${issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = EnvironmentException.name;
  }
}
