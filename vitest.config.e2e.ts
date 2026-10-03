import { defineConfig } from 'vitest/config';

/**
 * Configuração dos testes e2e (HTTP ponta a ponta sobre o AppModule).
 *
 * As variáveis de ambiente abaixo satisfazem a validação de configuração;
 * dependências externas (banco, filas) são substituídas via `overrideProvider`
 * em cada suíte.
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
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'mongodb://localhost:27017/bios_test?directConnection=true',
      DATA_RETENTION_SYNC_ON_BOOT: 'false',
    },
  },
});
