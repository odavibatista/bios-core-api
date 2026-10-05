/**
 * Operação destrutiva ou de preparação de banco (seed, reset) solicitada fora
 * de um banco descartável de testes.
 *
 * Não é uma exceção HTTP: protege o ambiente contra uso indevido de utilitários
 * de teste e nunca deve ocorrer em fluxo de requisição.
 */
export class UnsafeDatabaseOperationException extends Error {
  constructor(operation: string, environment: string, databaseName: string) {
    super(
      `Operação "${operation}" recusada: permitida apenas com NODE_ENV=test e banco ` +
        `de dados com sufixo "_test" (atual: NODE_ENV=${environment}, banco "${databaseName}").`,
    );
    this.name = UnsafeDatabaseOperationException.name;
  }
}
