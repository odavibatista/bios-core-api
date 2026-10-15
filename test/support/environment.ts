/**
 * Ambiente mínimo válido para montar módulos nas suítes.
 *
 * Existe para que uma variável obrigatória nova seja acrescentada em um só
 * lugar, e não em cada suíte que monta um módulo. Os valores são fixos de
 * propósito: são configuração, não dado de teste — nenhum deles aponta para
 * serviço real, e as chaves são de uso exclusivo das suítes.
 *
 * Quem precisa do endereço real da infraestrutura de teste sobrescreve o que
 * interessa (ex.: `{ REDIS_URL: inject('testRedisUrl') }`).
 */
export function buildTestEnvironment(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    // Sem isto a configuração montada na suíte assumiria `development`, e as
    // operações de preparação de banco (`seed`, `reset`) seriam recusadas.
    NODE_ENV: 'test',
    DATABASE_URL: 'mongodb://localhost:27017/bios_test?directConnection=true',
    REDIS_URL: 'redis://localhost:6379/1',
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
