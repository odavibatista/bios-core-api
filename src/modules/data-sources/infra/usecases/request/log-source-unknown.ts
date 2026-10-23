import type { Logger } from '@nestjs/common';
import { UnknownReason } from '../../../domain/unknown-reason.js';

/** Só as linhas de pilha (`at ...`): a primeira linha de `stack` é a mensagem do erro. */
function framesOf(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined;

  return error.stack
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n');
}

/**
 * Registra o motivo de uma coleta que terminou em `UNKNOWN`.
 *
 * Uma linha estruturada por ocorrência (`fonte` e `motivo` de um conjunto
 * fechado), para filtrar e contar por fonte. Nunca recebe a credencial, os
 * cabeçalhos, o corpo da resposta nem o CNPJ. Falhas esperadas saem como aviso;
 * `UNEXPECTED_ERROR` sai como erro, com o nome da exceção e as linhas da pilha,
 * e não a mensagem dela: defeito de programa precisa continuar visível sem
 * arrastar texto vindo da fonte.
 */
export function logSourceUnknown(
  logger: Logger,
  source: string,
  reason: UnknownReason,
  error?: unknown,
): void {
  const entry = { event: 'source_unknown', source, reason };

  if (reason !== UnknownReason.UNEXPECTED_ERROR) {
    logger.warn(entry);

    return;
  }

  logger.error(
    {
      ...entry,
      error: error instanceof Error ? error.name : typeof error,
    },
    framesOf(error),
  );
}
