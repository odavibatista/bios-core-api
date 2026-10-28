import 'vitest';

declare module 'vitest' {
  /**
   * Valores compartilhados entre o setup global e as suítes e2e (`inject`). As listas têm
   * um item por worker; as suítes usam os helpers de `test/support/infrastructure.ts`.
   */
  export interface ProvidedContext {
    /** Connection strings dos bancos descartáveis, uma por worker. */
    testDatabaseUrls: string[];
    /** Indica se o banco de teste está acessível; suítes com banco são ignoradas quando falso. */
    databaseAvailable: boolean;
    /** URLs dos bancos Redis de teste, uma por worker. */
    testRedisUrls: string[];
    /** Indica se o Redis está acessível; suítes com fila são ignoradas quando falso. */
    redisAvailable: boolean;
    /** Pastas temporárias, uma por worker. */
    testTemporaryDirectories: string[];
  }
}
