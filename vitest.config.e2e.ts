import { defineConfig } from 'vitest/config';
import { e2eWorkersInfrastructure } from './test/setup/e2e-workers.js';

/**
 * Infraestrutura descartável de cada worker (#368): os arquivos rodam em paralelo,
 * e cada worker tem banco MongoDB, banco Redis e pasta temporária próprios.
 *
 *  - E2E_DATABASE_URL: base dos nomes dos bancos (`bios_test` → `bios_w1_test`,
 *    `bios_w2_test`…). O sufixo `_test` é obrigatório: o setup global e o
 *    `PrismaService` recusam preparar ou apagar qualquer outro banco.
 *  - E2E_REDIS_URL: índice do primeiro worker; os seguintes usam os próximos.
 *    O índice 0 é recusado: o setup global limpa o banco inteiro, e o 0 é o de
 *    uso geral.
 *  - E2E_WORKERS: número de workers (padrão: 4, limitado aos núcleos da máquina;
 *    1 volta à execução em série).
 */
const INFRASTRUCTURE = e2eWorkersInfrastructure({
  workers: process.env.E2E_WORKERS,
  databaseUrl:
    process.env.E2E_DATABASE_URL ??
    'mongodb://localhost:27017/bios_test?directConnection=true',
  redisUrl: process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/1',
});

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
    setupFiles: [
      'test/setup/faker.setup.ts',
      // Reprova o arquivo que emitir MaxListenersExceededWarning (#259).
      'test/setup/listener-leak.setup.ts',
      // DATABASE_URL, REDIS_URL e pasta temporária do worker (#368).
      'test/setup/worker-infrastructure.setup.ts',
    ],
    // Um arquivo por worker de cada vez; arquivos em workers diferentes não dividem banco,
    // fila nem pasta temporária.
    maxWorkers: INFRASTRUCTURE.workers,
    fileParallelism: INFRASTRUCTURE.workers > 1,
    testTimeout: 15_000,
    hookTimeout: 30_000,
    provide: {
      testDatabaseUrls: INFRASTRUCTURE.databaseUrls,
      testRedisUrls: INFRASTRUCTURE.redisUrls,
      testTemporaryDirectories: INFRASTRUCTURE.temporaryDirectories,
    },
    env: {
      NODE_ENV: 'test',
      CGU_API_KEY: 'token-exclusivo-dos-testes-locais',
      // O setup do worker troca pelos dele. Se não trocar, a aplicação falha ao conectar,
      // em vez de ler os endereços de desenvolvimento do `.env` ou de dividir os de um
      // worker com os outros.
      DATABASE_URL:
        'mongodb://worker-sem-infraestrutura.invalid:27017/bios_unassigned_test',
      REDIS_URL: 'redis://worker-sem-infraestrutura.invalid:6379/1',
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
