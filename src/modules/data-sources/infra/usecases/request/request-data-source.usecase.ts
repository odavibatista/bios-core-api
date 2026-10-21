import { Injectable, Logger } from '@nestjs/common';
import { RequestOutcome } from '@prisma/client';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { UnknownDataSourceError } from '../../../domain/dtos/errors/unknown-data-source.error.js';
import {
  type DataSourceRequest,
  type DataSourceRequestConfig,
  SourceOutcome,
  type SourceResponse,
} from '../../../domain/dtos/providers/data-source-request.dto.js';
import { DataSourceRequestLogRepository } from '../../../domain/dtos/repositories/data-source-request-log.repository.js';
import { DataSourceRepository } from '../../../domain/dtos/repositories/data-source.repository.js';
import {
  SourceHttpClient,
  type SourceHttpResult,
} from '../../../domain/providers/source-http-client.provider.js';
import { SourceRateLimiter } from '../../../domain/providers/source-rate-limiter.provider.js';
import { buildSourceUrl } from '../../../domain/source-url.js';

/** Resposta de uma chamada que de fato aconteceu (ou foi recusada pelo limite): a que vai ao log. */
type CalledResponse = Exclude<
  SourceResponse,
  { outcome: typeof SourceOutcome.DISABLED }
>;

/** Tempo máximo de uma chamada quando a fonte não define o seu (`request_timeout_ms`). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** Maior mensagem de erro gravada no log. */
const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Infraestrutura comum das fontes externas: faz uma chamada respeitando o que o
 * catálogo declara para a fonte e a registra (NFPD01, NFPD02).
 *
 * Na ordem:
 *  1. lê a configuração da fonte (`data_sources`), de modo que desabilitar uma
 *     fonte ou mudar seu limite vale na chamada seguinte, sem novo deploy;
 *  2. fonte desabilitada: não chama;
 *  3. respeita o limite por minuto (`rate_limit_per_minute`): estourado, não
 *     chama e responde `RATE_LIMITED`;
 *  4. chama com o tempo máximo da fonte (`request_timeout_ms`);
 *  5. classifica o desfecho e o grava em `data_source_request_logs`.
 *
 * Falhas esperadas — fonte fora do ar, tempo esgotado, limite atingido — são
 * **resposta**, não exceção: quem chama (a cadeia de fallback, o job) decide o
 * que fazer com cada uma. A única exceção é a fonte inexistente no catálogo,
 * que é erro de programação.
 *
 * Gravar o log é acessório: se falhar, a chamada não é perdida nem desfeita.
 */
@Injectable()
export class RequestDataSourceUseCase extends UseCase<
  DataSourceRequest,
  SourceResponse
> {
  private readonly logger = new Logger(RequestDataSourceUseCase.name);

  constructor(
    private readonly dataSourceRepository: DataSourceRepository,
    private readonly requestLogRepository: DataSourceRequestLogRepository,
    private readonly rateLimiter: SourceRateLimiter,
    private readonly httpClient: SourceHttpClient,
  ) {
    super();
  }

  /**
   * @throws {UnknownDataSourceError} quando o `slug` não existe no catálogo.
   */
  override async execute(request: DataSourceRequest): Promise<SourceResponse> {
    const config = await this.dataSourceRepository.findRequestConfig(
      request.slug,
    );

    if (!config) throw new UnknownDataSourceError(request.slug);

    if (!config.isEnabled) return { outcome: SourceOutcome.DISABLED };

    const startedAt = Date.now();
    const response = await this.call(request, config);

    await this.record(request, config, response, Date.now() - startedAt);

    return response;
  }

  private async call(
    request: DataSourceRequest,
    config: DataSourceRequestConfig,
  ): Promise<CalledResponse> {
    if (config.rateLimitPerMinute !== null) {
      const refused = await this.refuseByRateLimit(
        config.slug,
        config.rateLimitPerMinute,
      );

      if (refused) return refused;
    }

    let url: string;

    try {
      url = buildSourceUrl(config.baseUrl, request.segments, request.query);
    } catch (error) {
      return {
        outcome: SourceOutcome.FAILURE,
        message: `URL da fonte inválida: ${errorMessageOf(error)}`,
      };
    }

    const http = {
      url,
      headers: request.headers ?? {},
      timeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    };
    const result = request.download
      ? await this.httpClient.download({ ...http, ...request.download })
      : await this.httpClient.get(http);

    return classify(result);
  }

  /** `null` quando a chamada pode seguir. */
  private async refuseByRateLimit(
    slug: string,
    limitPerMinute: number,
  ): Promise<CalledResponse | null> {
    try {
      const acquired = await this.rateLimiter.tryAcquire(slug, limitPerMinute);

      return acquired
        ? null
        : {
            outcome: SourceOutcome.RATE_LIMITED,
            message: `limite de ${limitPerMinute} requisições por minuto atingido`,
          };
    } catch (error) {
      // Sem contador não há como saber se a fonte aguenta: não chama.
      return {
        outcome: SourceOutcome.FAILURE,
        message: `contador do limite de requisições indisponível: ${errorMessageOf(error)}`,
      };
    }
  }

  private async record(
    request: DataSourceRequest,
    config: DataSourceRequestConfig,
    response: CalledResponse,
    durationMs: number,
  ): Promise<void> {
    try {
      await this.requestLogRepository.record({
        dataSourceId: config.id,
        ingestionRunId: request.context.ingestionRunId,
        cnpj: request.cnpj,
        trigger: request.context.trigger,
        outcome: RequestOutcome[response.outcome],
        httpStatus: 'status' in response ? response.status : undefined,
        durationMs,
        errorMessage:
          'message' in response
            ? response.message.slice(0, MAX_ERROR_MESSAGE_LENGTH)
            : undefined,
      });
    } catch (error) {
      this.logger.error(
        `Chamada a "${config.slug}" não registrada no log de requisições: ${errorMessageOf(error)}`,
      );
    }
  }
}

/** Traduz o desfecho HTTP para o resultado da chamada. */
function classify(result: SourceHttpResult): CalledResponse {
  if (result.kind === 'TIMEOUT') {
    return {
      outcome: SourceOutcome.TIMEOUT,
      message: 'tempo máximo da chamada esgotado',
    };
  }

  if (result.kind === 'FAILED') {
    return { outcome: SourceOutcome.FAILURE, message: result.message };
  }

  const { status } = result;

  if (status >= 200 && status < 300) {
    // JSON numa consulta; arquivo baixado numa chamada de download.
    const body = result.file ?? result.json;

    return body === undefined
      ? {
          outcome: SourceOutcome.FAILURE,
          status,
          message: 'resposta sem corpo',
        }
      : { outcome: SourceOutcome.SUCCESS, status, body };
  }

  if (status === 404) return { outcome: SourceOutcome.NOT_FOUND, status };

  if (status === 429) {
    return {
      outcome: SourceOutcome.RATE_LIMITED,
      status,
      message: 'a fonte recusou por excesso de requisições (HTTP 429)',
    };
  }

  return { outcome: SourceOutcome.FAILURE, status, message: `HTTP ${status}` };
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
