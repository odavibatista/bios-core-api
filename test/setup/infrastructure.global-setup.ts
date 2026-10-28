import { exec } from 'node:child_process';
import { mkdir, rm, rmdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import type { TestProject } from 'vitest/node';
import {
  databaseNameOf,
  DISPOSABLE_DATABASE_SUFFIX,
  isDisposableDatabase,
} from '../../src/shared/infra/database/database-name.js';
import { redisDatabaseOf } from './e2e-workers.js';

const PING_TIMEOUT_MS = 3_000;

const execAsync = promisify(exec);

/**
 * Prepara a infraestrutura dos testes e2e antes de todas as suítes e a desmonta
 * ao final. Cada worker tem a sua (#368; ver `e2e-workers.ts`), e todas são
 * preparadas aqui:
 *
 *  - MongoDB: sincroniza coleções e índices de cada banco com o schema Prisma
 *    (`db push`, em paralelo) e remove os bancos (`dropDatabase`) na desmontagem.
 *  - Redis: limpa o banco de cada worker (`FLUSHDB`), para que jobs de uma
 *    execução anterior não interfiram na seguinte.
 *  - Pastas temporárias: criadas vazias e removidas na desmontagem.
 *
 * Sem infraestrutura acessível: no CI a execução falha; localmente as suítes
 * que dependem de banco ou de fila são ignoradas com aviso, e as demais seguem
 * normalmente.
 */
export default async function setupTestInfrastructure(
  project: TestProject,
): Promise<() => Promise<void>> {
  const { testDatabaseUrls, testRedisUrls, testTemporaryDirectories } =
    project.getProvidedContext();

  await prepareRedis(project, testRedisUrls);
  await prepareTemporaryDirectories(testTemporaryDirectories);
  const dropDatabases = await prepareDatabases(project, testDatabaseUrls);

  return async () => {
    await removeTemporaryDirectories(testTemporaryDirectories);
    // A pasta que agrupa as dos workers; continua se outra execução ainda a usa.
    await rmdir(dirname(testTemporaryDirectories[0])).catch(() => undefined);
    await dropDatabases?.();
  };
}

async function prepareDatabases(
  project: TestProject,
  urls: string[],
): Promise<(() => Promise<void>) | undefined> {
  for (const url of urls) {
    const databaseName = databaseNameOf(url);

    if (!isDisposableDatabase(databaseName)) {
      throw new Error(
        `Banco de teste "${databaseName}" sem o sufixo "${DISPOSABLE_DATABASE_SUFFIX}": ` +
          'execução abortada para não apagar dados reais.',
      );
    }
  }

  const clients = urls.map((url) => new PrismaClient({ datasourceUrl: url }));
  const disconnect = () =>
    Promise.all(clients.map((client) => client.$disconnect()));

  // Os bancos estão no mesmo servidor: um ping responde por todos.
  if (!(await isDatabaseReachable(clients[0]))) {
    await disconnect();
    warn(
      project,
      'databaseAvailable',
      `MongoDB de teste indisponível em ${new URL(urls[0]).host}.`,
      'banco',
    );
    return undefined;
  }

  await Promise.all(
    urls.map((url) =>
      execAsync('npx prisma db push --skip-generate --accept-data-loss', {
        env: { ...process.env, DATABASE_URL: url },
      }),
    ),
  );
  project.provide('databaseAvailable', true);

  return async () => {
    await Promise.all(
      clients.map((client) => client.$runCommandRaw({ dropDatabase: 1 })),
    );
    await disconnect();
  };
}

/**
 * O índice do banco Redis é a garantia de descarte: o banco 0 é o de uso geral
 * (desenvolvimento), e limpá-lo apagaria filas reais.
 */
async function prepareRedis(
  project: TestProject,
  urls: string[],
): Promise<void> {
  for (const url of urls) {
    if (redisDatabaseOf(url) === 0) {
      throw new Error(
        `Redis de teste "${url}" aponta para o banco 0: execução abortada para ` +
          'não apagar filas reais. Use outro índice (ex.: redis://localhost:6379/1).',
      );
    }
  }

  for (const url of urls) {
    if (!(await flushOwnDatabase(url))) {
      // Os bancos estão no mesmo servidor: se um não responde, nenhum responde.
      warn(
        project,
        'redisAvailable',
        `Redis de teste indisponível em ${new URL(url).host}.`,
        'fila',
      );
      return;
    }
  }

  project.provide('redisAvailable', true);
}

/** Limpa o banco Redis; `false` quando o servidor não responde. */
async function flushOwnDatabase(url: string): Promise<boolean> {
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: PING_TIMEOUT_MS,
  });
  // Sem ouvinte, o evento de erro derruba o processo de teste.
  client.on('error', () => undefined);

  let connected = false;

  try {
    await client.connect();
    connected = true;
    await assertOwnDatabase(client, url);
    await client.flushdb();
    return true;
  } catch (error) {
    // Conectou e recusou: é problema de configuração, não de indisponibilidade.
    if (connected) throw error;

    return false;
  } finally {
    client.disconnect();
  }
}

/** Começa vazia: o que sobrou de uma execução interrompida não conta como resíduo. */
async function prepareTemporaryDirectories(directories: string[]) {
  await removeTemporaryDirectories(directories);
  await Promise.all(
    directories.map((directory) => mkdir(directory, { recursive: true })),
  );
}

async function removeTemporaryDirectories(directories: string[]) {
  await Promise.all(
    directories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
}

/** Prefixos das chaves gravadas pelo BIOS: cache próprio e filas do BullMQ. */
const OWN_KEY_PATTERN = /^(bios|bull):/;

/**
 * Recusa limpar um banco que tenha chave de outro sistema.
 *
 * O índice do banco já protege o banco de uso geral, mas não protege de um
 * Redis que não é o do BIOS ocupando a mesma porta — outro projeto rodando na
 * máquina, por exemplo. Uma amostra de chaves basta: se nenhuma é do BIOS e
 * existem chaves, o banco é de outro sistema.
 */
async function assertOwnDatabase(client: Redis, url: string): Promise<void> {
  const [, keys] = await client.scan(0, 'COUNT', 100);
  const foreign = keys.find((key) => !OWN_KEY_PATTERN.test(key));

  if (foreign) {
    throw new Error(
      `Redis de teste em ${new URL(url).host} tem a chave "${foreign}", que ` +
        'não foi gravada pelo BIOS: execução abortada para não apagar dados ' +
        'de outro sistema. Suba o Redis do docker-compose.yml do projeto ou ' +
        'aponte E2E_REDIS_URL para um banco exclusivo.',
    );
  }
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
