import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { RateLimitExceededException } from '../../domain/errors/rate-limit-exceeded.exception.js';

/**
 * Guarda de limite de requisições (NFSE04).
 *
 * Só troca a exceção da biblioteca pela exceção de domínio, para que o 429
 * saia no mesmo corpo padronizado dos outros erros, com código estável
 * (`RATE_LIMIT_EXCEEDED`) e mensagem em português. O cabeçalho `Retry-After`
 * já é escrito pela guarda da biblioteca antes de lançar.
 *
 * A contagem e as chaves de rastreio ficam na configuração
 * (`throttler.config.ts`): por IP no limite geral, por chave de API no limite
 * da API pública.
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected override throwThrottlingException(
    _context: ExecutionContext,
    { limit, timeToBlockExpire }: ThrottlerLimitDetail,
  ): Promise<void> {
    // Promessa rejeitada, e não `throw` síncrono: a biblioteca aguarda este
    // retorno, e um lançamento síncrono escaparia do fluxo que ela espera.
    return Promise.reject(
      new RateLimitExceededException(limit, timeToBlockExpire),
    );
  }
}
