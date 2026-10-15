import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { RateLimitExceededException } from '../../domain/errors/rate-limit-exceeded.exception.js';

/**
 * Guarda de limite de requisições (NFSE04).
 *
 * Troca a exceção da biblioteca pela exceção de domínio, para que o 429 saia
 * no mesmo corpo padronizado dos outros erros, com código estável
 * (`RATE_LIMIT_EXCEEDED`) e mensagem em português.
 *
 * Garante também o cabeçalho `Retry-After` padrão. A biblioteca o escreve com
 * o nome do limite como sufixo quando este não é o `default`
 * (`Retry-After-publicApi`), e é o nome padrão que clientes HTTP e
 * integradores respeitam. Os cabeçalhos com sufixo continuam sendo enviados.
 *
 * A contagem e as chaves de rastreio ficam na configuração
 * (`throttler.config.ts`): por IP no limite geral, por chave de API no limite
 * da API pública.
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected override throwThrottlingException(
    context: ExecutionContext,
    { limit, timeToBlockExpire }: ThrottlerLimitDetail,
  ): Promise<void> {
    this.setResponseHeader(
      this.getRequestResponse(context).res,
      'Retry-After',
      timeToBlockExpire,
    );

    // Promessa rejeitada, e não `throw` síncrono: a biblioteca aguarda este
    // retorno, e um lançamento síncrono escaparia do fluxo que ela espera.
    return Promise.reject(
      new RateLimitExceededException(limit, timeToBlockExpire),
    );
  }
}
