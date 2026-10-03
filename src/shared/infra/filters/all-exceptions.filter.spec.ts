import { type ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { DependencyUnavailableException } from '../../domain/errors/dependency-unavailable.exception.js';
import { ValidationFailedException } from '../../domain/errors/validation-failed.exception.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

describe('AllExceptionsFilter', () => {
  const response = {};
  const reply = vi.fn();
  const httpAdapterHost = {
    httpAdapter: { getRequestUrl: vi.fn(() => '/companies'), reply },
  } as unknown as HttpAdapterHost;
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  const filter = new AllExceptionsFilter(httpAdapterHost);

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('usa código e detalhes definidos pela exceção de domínio', () => {
    const issues = [{ path: 'cnpj', message: 'inválido' }];

    filter.catch(new ValidationFailedException(issues), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({
        statusCode: 422,
        code: 'VALIDATION_FAILED',
        details: issues,
        path: '/companies',
      }),
      422,
    );
  });

  it('deriva o código do status para exceções HTTP do framework', () => {
    filter.catch(new NotFoundException('Empresa não encontrada.'), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Empresa não encontrada.',
      }),
      404,
    );
  });

  it('responde 500 genérico para erros desconhecidos e registra o erro', () => {
    filter.catch(new Error('falha interna com detalhe sensível'), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Erro interno do servidor.',
      }),
      500,
    );
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('registra erros 5xx de domínio', () => {
    filter.catch(new DependencyUnavailableException('database'), host);

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      'DEPENDENCY_UNAVAILABLE em /companies',
      expect.any(String),
    );
  });

  it('não registra erros 4xx', () => {
    filter.catch(new NotFoundException(), host);

    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });

  it('trata valores lançados que não são Error', () => {
    filter.catch('valor inesperado', host);

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      'INTERNAL_ERROR em /companies',
      'valor inesperado',
    );
  });
});
