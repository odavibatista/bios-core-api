import { defineConfig } from 'vitest/config';

/**
 * Banco descartável dos testes e2e. O sufixo `_test` é obrigatório: o setup
 * global e o `PrismaService` recusam preparar ou apagar qualquer outro banco.
 */
const TEST_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'mongodb://localhost:27017/bios_test?directConnection=true';

/**
 * Redis descartável dos testes e2e. O índice do banco é obrigatório e diferente
 * de 0: o setup global limpa o banco inteiro e recusa fazê-lo no banco de uso
 * geral.
 */
const TEST_REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/1';

/**
 * Configuração dos testes e2e (HTTP ponta a ponta sobre o AppModule).
 *
 *  - test/http/: pipeline HTTP com dependências substituídas via `overrideProvider`;
 *  - test/database/: AppModule completo contra o MongoDB de teste, montado e
 *    desmontado pelo setup global a cada execução;
 *  - test/integration/: módulos de infraestrutura contra o serviço real
 *    correspondente (ex.: filas contra o Redis de teste).
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
    globalSetup: ['test/setup/infrastructure.global-setup.ts'],
    // Semente do Faker por arquivo, exibida quando um teste falha.
    setupFiles: ['test/setup/faker.setup.ts'],
    // As suítes compartilham o mesmo banco: execução em série.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
    provide: {
      testDatabaseUrl: TEST_DATABASE_URL,
      testRedisUrl: TEST_REDIS_URL,
    },
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      DATA_RETENTION_SYNC_ON_BOOT: 'false',
      // Sem agendamento no boot: as suítes registram o que precisam testar.
      QUEUE_SCHEDULES_SYNC_ON_BOOT: 'false',
      // Prazo curto da espera por jobs: os cenários de "serviço de ingestão
      // não responde" terminam em segundos, e não nos 10s do padrão.
      QUEUE_WAIT_TIMEOUT_MS: '3000',
      // Chaves de teste: valores fixos, nunca usados fora das suítes.
      ENCRYPTION_KEYS: `1:${'e'.repeat(43)}=`,
      BLIND_INDEX_KEY: `${'b'.repeat(43)}=`,
      AUTH_ACCESS_TOKEN_SECRET: `${'a'.repeat(43)}=`,
      // Custo mínimo do bcrypt: as suítes verificam comportamento, não dureza.
      BCRYPT_COST: '4',
      // SMTP inexistente: nenhuma suíte envia e-mail de verdade — o transporte é
      // substituído por `jsonTransport` ou por dublê.
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      SMTP_USER: 'bios-testes',
      SMTP_PASSWORD: 'senha-de-teste',
      MAIL_FROM: 'BIOS <nao-responda@bios.test>',
      FRONTEND_URL: 'https://bios.test',
    },
  },
});
