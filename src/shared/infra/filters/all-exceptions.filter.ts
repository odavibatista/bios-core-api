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
 * Filtro global que converte qualquer exceção no corpo de erro padronizado
 * (`ErrorResponse`).
 *
 * - `DomainException`: usa o código e os detalhes definidos pelo domínio;
 * - `HttpException` do framework: deriva o código do status HTTP;
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

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();

      return {
        statusCode,
        code: HttpStatus[statusCode] ?? 'HTTP_ERROR',
        message: exception.message,
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
