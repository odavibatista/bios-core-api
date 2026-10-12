import { HttpStatus } from '@nestjs/common';
import { DomainException } from './domain.exception.js';

/**
 * Um job foi publicado, mas não concluiu dentro do prazo de espera.
 *
 * Não é falha do job: ele segue na fila e pode concluir depois. Para fontes não
 * bloqueantes, o chamador trata esta exceção exibindo a evidência como
 * desconhecida, em vez de falhar a consulta (NFCO01).
 */
export class QueueTimeoutException extends DomainException {
  constructor(queue: string, jobName: string, timeoutMs: number) {
    super(
      'QUEUE_TIMEOUT',
      'O processamento não foi concluído no tempo esperado.',
      HttpStatus.GATEWAY_TIMEOUT,
      { queue, job: jobName, timeout_ms: timeoutMs },
    );
  }
}
