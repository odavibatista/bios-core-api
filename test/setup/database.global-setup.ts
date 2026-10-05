import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import type { TestProject } from 'vitest/node';
import {
  databaseNameOf,
  DISPOSABLE_DATABASE_SUFFIX,
  isDisposableDatabase,
} from '../../src/shared/infra/database/database-name.js';

const PING_TIMEOUT_MS = 3_000;

/**
 * Monta o banco descartável dos testes e2e antes de todas as suítes e o
 * desmonta ao final.
 *
 *  - Montagem: sincroniza coleções e índices com o schema Prisma (`db push`).
 *  - Desmontagem: remove o banco inteiro (`dropDatabase`).
 *
 * Sem banco acessível: no CI a execução falha; localmente as suítes que
 * dependem de banco são ignoradas com aviso, e as demais seguem normalmente.
 */
export default async function setupTestDatabase(
  project: TestProject,
): Promise<(() => Promise<void>) | undefined> {
  const url = project.getProvidedContext().testDatabaseUrl;
  const databaseName = databaseNameOf(url);

  if (!isDisposableDatabase(databaseName)) {
    throw new Error(
      `Banco de teste "${databaseName}" sem o sufixo "${DISPOSABLE_DATABASE_SUFFIX}": ` +
        'execução abortada para não apagar dados reais.',
    );
  }

  const client = new PrismaClient({ datasourceUrl: url });

  if (!(await isReachable(client))) {
    await client.$disconnect();

    const message =
      `MongoDB de teste indisponível em ${new URL(url).host}. ` +
      'Suba a infraestrutura local com "npm run docker:up".';

    if (process.env.CI) throw new Error(message);

    console.warn(
      `\n⚠  ${message}\n   As suítes que dependem de banco foram ignoradas.\n`,
    );
    project.provide('databaseAvailable', false);
    return undefined;
  }

  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  project.provide('databaseAvailable', true);

  return async () => {
    await client.$runCommandRaw({ dropDatabase: 1 });
    await client.$disconnect();
  };
}

async function isReachable(client: PrismaClient): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), PING_TIMEOUT_MS);
  });
  const ping = client.$runCommandRaw({ ping: 1 }).then(
    () => true,
    () => false,
  );

  try {
    return await Promise.race([ping, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
