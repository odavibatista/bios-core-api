import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import type { TestProject } from 'vitest/node';
import {
  databaseNameOf,
  DISPOSABLE_DATABASE_SUFFIX,
  isDisposableDatabase,
} from '../../src/shared/infra/database/database-name.js';

const PING_TIMEOUT_MS = 3_000;

/**
 * Prepara a infraestrutura dos testes e2e antes de todas as suítes e a desmonta
 * ao final.
 *
 *  - MongoDB: sincroniza coleções e índices com o schema Prisma (`db push`) e
 *    remove o banco inteiro (`dropDatabase`) na desmontagem.
 *  - Redis: limpa o banco de teste (`FLUSHDB`), para que jobs de uma execução
 *    anterior não interfiram na seguinte.
 *
 * Sem infraestrutura acessível: no CI a execução falha; localmente as suítes
 * que dependem de banco ou de fila são ignoradas com aviso, e as demais seguem
 * normalmente.
 */
export default async function setupTestInfrastructure(
  project: TestProject,
): Promise<(() => Promise<void>) | undefined> {
  const { testDatabaseUrl, testRedisUrl } = project.getProvidedContext();

  await prepareRedis(project, testRedisUrl);

  return prepareDatabase(project, testDatabaseUrl);
}

async function prepareDatabase(
  project: TestProject,
  url: string,
): Promise<(() => Promise<void>) | undefined> {
  const databaseName = databaseNameOf(url);

  if (!isDisposableDatabase(databaseName)) {
    throw new Error(
      `Banco de teste "${databaseName}" sem o sufixo "${DISPOSABLE_DATABASE_SUFFIX}": ` +
        'execução abortada para não apagar dados reais.',
    );
  }

  const client = new PrismaClient({ datasourceUrl: url });

  if (!(await isDatabaseReachable(client))) {
    await client.$disconnect();
    warn(
      project,
      'databaseAvailable',
      `MongoDB de teste indisponível em ${new URL(url).host}.`,
      'banco',
    );
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

/**
 * O índice do banco Redis é a garantia de descarte: o banco 0 é o de uso geral
 * (desenvolvimento), e limpá-lo apagaria filas reais.
 */
async function prepareRedis(project: TestProject, url: string): Promise<void> {
  if (databaseIndexOf(url) === 0) {
    throw new Error(
      `Redis de teste "${url}" aponta para o banco 0: execução abortada para ` +
        'não apagar filas reais. Use outro índice (ex.: redis://localhost:6379/1).',
    );
  }

  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: PING_TIMEOUT_MS,
  });
  // Sem ouvinte, o evento de erro derruba o processo de teste.
  client.on('error', () => undefined);

  try {
    await client.connect();
    await client.flushdb();
    project.provide('redisAvailable', true);
  } catch {
    warn(
      project,
      'redisAvailable',
      `Redis de teste indisponível em ${new URL(url).host}.`,
      'fila',
    );
  } finally {
    client.disconnect();
  }
}

/** Índice do banco Redis na URL (`redis://host:porta/índice`); 0 quando omitido. */
function databaseIndexOf(url: string): number {
  return Number(new URL(url).pathname.replace('/', '') || 0);
}

function warn(
  project: TestProject,
  flag: 'databaseAvailable' | 'redisAvailable',
  problem: string,
  dependents: string,
): void {
  const message = `${problem} Suba a infraestrutura local com "npm run docker:up".`;

  if (process.env.CI) throw new Error(message);

  console.warn(
    `\n⚠  ${message}\n   As suítes que dependem de ${dependents} foram ignoradas.\n`,
  );
  project.provide(flag, false);
}

async function isDatabaseReachable(client: PrismaClient): Promise<boolean> {
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
