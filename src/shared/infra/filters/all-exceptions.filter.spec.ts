import {
  type ArgumentsHost,
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { faker } from '@test/support/faker.js';
import { DependencyUnavailableException } from '../../domain/errors/dependency-unavailable.exception.js';
import { ValidationFailedException } from '../../domain/errors/validation-failed.exception.js';
import {
  AllExceptionsFilter,
  FRAMEWORK_ERROR_FALLBACK,
  FRAMEWORK_ERROR_MESSAGES,
} from './all-exceptions.filter.js';

describe('AllExceptionsFilter', () => {
  const path = `/${faker.lorem.slug(2)}`;
  const response = {};
  const reply = vi.fn();
  const httpAdapterHost = {
    httpAdapter: { getRequestUrl: vi.fn(() => path), reply },
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
    const issues = [
      { path: faker.database.column(), message: faker.lorem.sentence() },
    ];

    filter.catch(new ValidationFailedException(issues), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({
        statusCode: 422,
        code: 'VALIDATION_FAILED',
        details: issues,
        path,
      }),
      422,
    );
  });

  it('deriva o código do status para exceções HTTP do framework, com mensagem em português', () => {
    filter.catch(new NotFoundException('Cannot GET /rota'), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Rota não encontrada.',
      }),
      404,
    );
  });

  it('não repassa o texto original do framework, que pode expor detalhe interno', () => {
    const internal = `Unexpected token 'n', "${faker.lorem.word()}" is not valid JSON`;

    filter.catch(new BadRequestException(internal), host);

    const [, body] = reply.mock.calls[0] as [unknown, { message: string }];
    expect(body).toMatchObject({
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: FRAMEWORK_ERROR_MESSAGES[400],
    });
    expect(body.message).not.toContain(internal);
  });

  it.each([
    [413, 'PAYLOAD_TOO_LARGE'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
    [405, 'METHOD_NOT_ALLOWED'],
  ])(
    'status %i do framework: código %s e mensagem da tabela',
    (status, code) => {
      filter.catch(new HttpException('original', status), host);

      expect(reply).toHaveBeenCalledWith(
        response,
        expect.objectContaining({
          statusCode: status,
          code,
          message: FRAMEWORK_ERROR_MESSAGES[status],
        }),
        status,
      );
    },
  );

  it('status do framework sem texto na tabela: mensagem genérica', () => {
    filter.catch(new HttpException('I am a teapot', 418), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({
        statusCode: 418,
        code: 'I_AM_A_TEAPOT',
        message: FRAMEWORK_ERROR_FALLBACK,
      }),
      418,
    );
  });

  it('status sem nome no HttpStatus: código HTTP_ERROR', () => {
    filter.catch(new HttpException('x', 499), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({ statusCode: 499, code: 'HTTP_ERROR' }),
      499,
    );
  });

  it('erro 4xx no formato http-errors (body-parser) vira o status dele, e não 500', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      statusCode: 413,
      expose: true,
    });

    filter.catch(tooLarge, host);

    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({
        statusCode: 413,
        code: 'PAYLOAD_TOO_LARGE',
        message: FRAMEWORK_ERROR_MESSAGES[413],
      }),
      413,
    );
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });

  it.each([
    ['5xx', { statusCode: 503 }],
    ['status que não é número', { statusCode: '413' }],
    ['abaixo de 400', { statusCode: 302 }],
  ])(
    'erro com statusCode fora dos 4xx (%s) cai no 500 genérico',
    (_, extra) => {
      filter.catch(Object.assign(new Error('falha'), extra), host);

      expect(reply).toHaveBeenCalledWith(
        response,
        expect.objectContaining({ statusCode: 500, code: 'INTERNAL_ERROR' }),
        500,
      );
    },
  );

  it('responde 500 genérico para erros desconhecidos e registra o erro', () => {
    filter.catch(new Error(faker.lorem.sentence()), host);

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
    filter.catch(new DependencyUnavailableException(faker.lorem.word()), host);

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      `DEPENDENCY_UNAVAILABLE em ${path}`,
      expect.any(String),
    );
  });

  it('não registra erros 4xx', () => {
    filter.catch(new NotFoundException(), host);

    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });

  it('trata valores lançados que não são Error', () => {
    const thrown = faker.lorem.sentence();

    filter.catch(thrown, host);

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      `INTERNAL_ERROR em ${path}`,
      thrown,
    );
  });
});
