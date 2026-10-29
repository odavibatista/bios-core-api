import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { ErrorResponse } from '../../domain/dtos/errors/error-response.dto.js';
import { DomainException } from '../../domain/errors/domain.exception.js';

/**
 * Mensagens, em português, dos erros que o próprio framework produz (o código do BIOS lança
 * só `DomainException`, que já traz a sua). O texto original vem em inglês e às vezes expõe um
 * detalhe interno (`Unexpected token 'n' ... is not valid JSON`, `Cannot GET /x`), então não é
 * repassado.
 */
export const FRAMEWORK_ERROR_MESSAGES: Readonly<
  Partial<Record<number, string>>
> = {
  [HttpStatus.BAD_REQUEST]:
    'Requisição malformada: confira se o corpo é um JSON válido e se o endereço está bem codificado.',
  [HttpStatus.UNAUTHORIZED]: 'Autenticação necessária. Entre para continuar.',
  [HttpStatus.FORBIDDEN]: 'Acesso negado.',
  [HttpStatus.NOT_FOUND]: 'Rota não encontrada.',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'Método não permitido nesta rota.',
  [HttpStatus.NOT_ACCEPTABLE]: 'Formato de resposta não aceito.',
  [HttpStatus.REQUEST_TIMEOUT]: 'Tempo da requisição esgotado.',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'O corpo da requisição é grande demais.',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]:
    'Tipo de conteúdo não suportado: envie o corpo como application/json.',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Os dados enviados são inválidos.',
  [HttpStatus.TOO_MANY_REQUESTS]:
    'Limite de requisições excedido. Tente novamente em instantes.',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Erro interno do servidor.',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Serviço temporariamente indisponível.',
};

/** Mensagem de um status do framework sem texto próprio na tabela. */
export const FRAMEWORK_ERROR_FALLBACK =
  'Não foi possível atender a requisição.';

/**
 * Status de um erro do framework: a `HttpException` e o erro no formato `http-errors` (usado
 * pelo body-parser e pelo Express), que algumas versões do adaptador entregam sem converter,
 * como o 413 de corpo grande demais. Só os 4xx desse formato: um 5xx é falha do servidor e cai
 * no 500 genérico. `null` para o que não é erro do framework.
 */
function frameworkStatusOf(exception: unknown): number | null {
  if (exception instanceof HttpException) return exception.getStatus();

  if (exception instanceof Error && 'statusCode' in exception) {
    const { statusCode } = exception;

    if (
      typeof statusCode === 'number' &&
      statusCode >= 400 &&
      statusCode < 500
    ) {
      return statusCode;
    }
  }

  return null;
}

/**
 * Filtro global que converte qualquer exceção no corpo de erro padronizado
 * (`ErrorResponse`).
 *
 * - `DomainException`: usa o código, a mensagem e os detalhes definidos pelo domínio;
 * - erro do framework (`HttpException` ou `http-errors`): deriva o código do status HTTP, com
 *   a mensagem em português de `FRAMEWORK_ERROR_MESSAGES`;
 * - qualquer outro erro: responde 500 sem expor detalhes internos e registra o erro.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const context = host.switchToHttp();
    const path = String(httpAdapter.getRequestUrl(context.getRequest()));
    const body = this.toErrorResponse(exception, path);

    if (body.statusCode >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(
        `${body.code} em ${path}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    httpAdapter.reply(context.getResponse(), body, body.statusCode);
  }

  private toErrorResponse(exception: unknown, path: string): ErrorResponse {
    const timestamp = new Date().toISOString();

    if (exception instanceof DomainException) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
        timestamp,
        path,
      };
    }

    const statusCode = frameworkStatusOf(exception);

    if (statusCode !== null) {
      return {
        statusCode,
        code: HttpStatus[statusCode] ?? 'HTTP_ERROR',
        message:
          FRAMEWORK_ERROR_MESSAGES[statusCode] ?? FRAMEWORK_ERROR_FALLBACK,
        timestamp,
        path,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Erro interno do servidor.',
      timestamp,
      path,
    };
  }
}
