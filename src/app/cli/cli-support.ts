import { existsSync } from 'node:fs';

/** Código de saída dos comandos: 0 ok, 1 falha, 2 uso incorreto. */
export const CliExit = { OK: 0, FAILURE: 1, USAGE: 2 } as const;

/** Carrega o `.env` da pasta atual, quando existe (os comandos rodam fora da API). */
export function loadDotEnv(): void {
  if (existsSync('.env')) process.loadEnvFile('.env');
}

/** Nunca devolve uma connection string, mesmo que o driver a inclua na mensagem. */
export function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.replace(/mongodb(\+srv)?:\/\/\S+/gi, '[conexão omitida]');
}
