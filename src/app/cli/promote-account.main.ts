import { PrismaClient } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import {
  type Environment,
  validateEnvironment,
} from '@shared/config/environment.config.js';
import { databaseNameOf } from '@shared/infra/database/database-name.js';
import { AesEncryptionProvider } from '@shared/infra/providers/aes-encryption.provider.js';
import { loadDotEnv, safeMessage } from './cli-support.js';
import { runPromoteAccount } from './promote-account.runner.js';

/**
 * Entrada do comando `npm run account:promote` (#329): lê o `.env`, valida o ambiente como
 * a API faz, conecta ao banco e delega ao runner. O índice cego do e-mail usa o mesmo
 * provider da API, com a mesma chave; a chave nunca é impressa.
 */
async function main(): Promise<void> {
  loadDotEnv();

  let environment: Environment;

  try {
    environment = validateEnvironment(process.env);
  } catch (error) {
    console.error(`Ambiente inválido: ${safeMessage(error)}`);
    process.exit(1);
  }

  // O provider só lê duas chaves do ambiente; um leitor mínimo dispensa subir o Nest.
  const config = {
    get: (key: keyof Environment) => environment[key],
  } as unknown as ConfigService<Environment, true>;
  const encryption = new AesEncryptionProvider(config);
  const client = new PrismaClient();
  const code = await runPromoteAccount(process.argv.slice(2), {
    client,
    databaseName: databaseNameOf(environment.DATABASE_URL),
    blindIndex: (value) => encryption.blindIndex(value),
    write: (line) => console.log(line),
  }).finally(() => client.$disconnect());

  process.exit(code);
}

void main();
