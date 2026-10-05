import { defineConfig } from 'vitest/config';

/**
 * Banco descartável dos testes e2e. O sufixo `_test` é obrigatório: o setup
 * global e o `PrismaService` recusam preparar ou apagar qualquer outro banco.
 */
const TEST_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'mongodb://localhost:27017/bios_test?directConnection=true';

/**
 * Configuração dos testes e2e (HTTP ponta a ponta sobre o AppModule).
 *
 *  - test/http/: pipeline HTTP com dependências substituídas via `overrideProvider`;
 *  - test/database/: AppModule completo contra o MongoDB de teste, montado e
 *    desmontado pelo setup global a cada execução.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    clearMocks: true,
    restoreMocks: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['test/setup/database.global-setup.ts'],
    // As suítes compartilham o mesmo banco: execução em série.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
    provide: {
      testDatabaseUrl: TEST_DATABASE_URL,
    },
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      DATA_RETENTION_SYNC_ON_BOOT: 'false',
    },
  },
});
