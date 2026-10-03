import { HttpException, type HttpStatus } from '@nestjs/common';

/**
 * Exceção de domínio base do BIOS.
 *
 * Toda exceção de negócio estende esta classe e carrega, além do status HTTP,
 * um `code` estável: o consumidor da API trata o erro pelo código, sem depender
 * do texto da mensagem. A tradução para o corpo de resposta padronizado fica a
 * cargo do `AllExceptionsFilter`.
 */
export abstract class DomainException extends HttpException {
  protected constructor(
    readonly code: string,
    message: string,
    status: HttpStatus,
    readonly details?: unknown,
  ) {
    super(message, status);
    this.name = new.target.name;
  }
}
