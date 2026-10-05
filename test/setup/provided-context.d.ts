import 'vitest';

declare module 'vitest' {
  /** Valores compartilhados entre o setup global e as suítes e2e (`inject`). */
  export interface ProvidedContext {
    /** Connection string do banco descartável dos testes e2e. */
    testDatabaseUrl: string;
    /** Indica se o banco de teste está acessível; suítes com banco são ignoradas quando falso. */
    databaseAvailable: boolean;
  }
}
