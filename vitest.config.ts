import { defineConfig } from 'vitest/config';

/**
 * Configuração dos testes unitários, de integração e de componente.
 *
 * O limite de cobertura de 75% espelha o RNF [NFPD03]. Ficam fora da medição
 * apenas os arquivos sem comportamento próprio: bootstrap da aplicação e
 * declarações de módulo Nest.
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
    // Semente do Faker por arquivo, exibida quando um teste falha.
    setupFiles: ['test/setup/faker.setup.ts'],
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/app/main.ts', 'src/**/*.module.ts'],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 75,
        statements: 75,
      },
    },
  },
});
