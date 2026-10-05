import { defineConfig } from 'vitest/config';

/**
 * Arquivos fora da medição de cobertura, identificados pelo sufixo do nome.
 *
 * Os testes desses arquivos continuam sendo executados; eles apenas não entram
 * no cálculo do limite mínimo.
 */
const COVERAGE_EXCLUDE = [
  // Os próprios testes e o bootstrap da aplicação.
  'src/**/*.spec.ts',
  'src/app/main.ts',
  // Seeders de catálogo, exercitados contra o banco real nos testes e2e.
  'src/**/*seeder.ts',
  // Configuração da aplicação, validada na inicialização.
  'src/**/*config.ts',
  // Declarações: exceções de domínio, contratos, decorators e módulos do Nest.
  'src/**/*.exception.ts',
  'src/**/*.protocol.ts',
  'src/**/*.decorator.ts',
  'src/**/*.module.ts',
];

/**
 * Configuração dos testes unitários, de integração e de componente.
 *
 * O limite de cobertura de 75% espelha o RNF [NFPD03] e vale para cada métrica
 * (linhas, funções, branches e statements) sobre o código de `src/`.
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
      reportsDirectory: './coverage',
      // Gera o relatório mesmo quando um teste falha, para o resumo do CI.
      reportOnFailure: true,
      include: ['src/**/*.ts'],
      exclude: COVERAGE_EXCLUDE,
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 75,
        statements: 75,
      },
    },
  },
});
