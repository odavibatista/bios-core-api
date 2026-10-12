import { HttpStatus } from '@nestjs/common';
import { DomainException } from './domain.exception.js';

/**
 * Um job esgotou as tentativas e terminou em falha.
 *
 * O motivo informado pelo consumidor fica em `details`, para o log; a mensagem
 * ao consumidor da API não o expõe, porque pode carregar detalhes da fonte
 * externa.
 */
export class QueueJobFailedException extends DomainException {
  constructor(queue: string, jobName: string, reason: string) {
    super(
      'QUEUE_JOB_FAILED',
      'O processamento não pôde ser concluído.',
      HttpStatus.BAD_GATEWAY,
      { queue, job: jobName, reason },
    );
  }
}
