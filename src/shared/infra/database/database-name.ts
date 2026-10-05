/** Sufixo obrigatório do nome de um banco descartável de testes. */
export const DISPOSABLE_DATABASE_SUFFIX = '_test';

/** Nome do banco de dados indicado na connection string MongoDB. */
export function databaseNameOf(connectionString: string): string {
  return decodeURIComponent(new URL(connectionString).pathname.slice(1));
}

/**
 * Indica se o banco pode ser preparado e apagado livremente pelos testes.
 */
export function isDisposableDatabase(databaseName: string): boolean {
  return (
    databaseName.length > DISPOSABLE_DATABASE_SUFFIX.length &&
    databaseName.endsWith(DISPOSABLE_DATABASE_SUFFIX)
  );
}
