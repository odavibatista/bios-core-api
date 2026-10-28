import { inject } from 'vitest';
import { testDatabaseUrl, testRedisUrl } from './infrastructure.js';

/**
 * Ambiente mínimo válido para montar módulos nas suítes.
 *
 * Existe para que uma variável obrigatória nova seja acrescentada em um só
 * lugar, e não em cada suíte que monta um módulo. Os valores são fixos de
 * propósito: são configuração, não dado de teste — nenhum deles aponta para
 * serviço real, e as chaves são de uso exclusivo das suítes.
 *
 * Banco e Redis são os do worker nos testes e2e (ver `testInfrastructure`).
 */
export function buildTestEnvironment(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    // Sem isto a configuração montada na suíte assumiria `development`, e as
    // operações de preparação de banco (`seed`, `reset`) seriam recusadas.
    NODE_ENV: 'test',
    CGU_API_KEY: 'token-exclusivo-dos-testes-locais',
    ...testInfrastructure(),
    ENCRYPTION_KEYS: `1:${'e'.repeat(43)}=`,
    BLIND_INDEX_KEY: `${'b'.repeat(43)}=`,
    AUTH_ACCESS_TOKEN_SECRET: `${'a'.repeat(43)}=`,
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    SMTP_USER: 'bios-testes',
    SMTP_PASSWORD: 'senha-de-teste',
    MAIL_FROM: 'BIOS <nao-responda@bios.test>',
    FRONTEND_URL: 'https://bios.test',
    ...overrides,
  };
}

/**
 * Banco e Redis do ambiente.
 *
 * Nos testes e2e são os do worker (#368): uma suíte que monta módulos com este
 * ambiente e acessa o banco ou a fila nunca cai num endereço dividido com outro
 * worker, nem num banco sem os índices do schema. Nos testes unitários não há
 * infraestrutura preparada (o `inject` vem vazio) nem conexão, e os endereços
 * são fixos.
 */
function testInfrastructure(): { DATABASE_URL: string; REDIS_URL: string } {
  const prepared = inject('testDatabaseUrls') as string[] | undefined;

  if (prepared === undefined) {
    return {
      DATABASE_URL: 'mongodb://localhost:27017/bios_test?directConnection=true',
      REDIS_URL: 'redis://localhost:6379/1',
    };
  }

  return { DATABASE_URL: testDatabaseUrl(), REDIS_URL: testRedisUrl() };
}

/**
 * O mesmo ambiente, sem as variáveis informadas: serve às suítes que provam
 * que a aplicação não sobe sem uma configuração obrigatória.
 */
export function buildTestEnvironmentWithout(
  ...variables: string[]
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(buildTestEnvironment()).filter(
      ([name]) => !variables.includes(name),
    ),
  );
}
