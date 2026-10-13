import { HttpStatus } from '@nestjs/common';
import { DomainException } from './domain.exception.js';

/**
 * O limite de requisições do consumidor foi excedido (NFSE04).
 *
 * O corpo informa quantas requisições cabem na janela e quanto falta para
 * liberar, para que o integrador possa se ajustar; o cabeçalho `Retry-After`
 * carrega o mesmo prazo.
 */
export class RateLimitExceededException extends DomainException {
  constructor(limit: number, retryAfterSeconds: number) {
    super(
      'RATE_LIMIT_EXCEEDED',
      'Limite de requisições excedido. Tente novamente em instantes.',
      HttpStatus.TOO_MANY_REQUESTS,
      { limit, retry_after_seconds: retryAfterSeconds },
    );
  }
}
