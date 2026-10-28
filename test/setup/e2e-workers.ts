import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  databaseNameOf,
  DISPOSABLE_DATABASE_SUFFIX,
} from '../../src/shared/infra/database/database-name.js';

/** Workers quando `E2E_WORKERS` não é informada (limitado aos núcleos da máquina). */
const DEFAULT_WORKERS = 4;

/** Último banco do Redis na configuração padrão do servidor (`databases 16`). */
const LAST_REDIS_DATABASE = 15;

/** Recursos descartáveis de cada worker, na ordem de `VITEST_POOL_ID` (1, 2, …). */
export interface E2eWorkersInfrastructure {
  workers: number;
  databaseUrls: string[];
  redisUrls: string[];
  temporaryDirectories: string[];
}

/**
 * Banco MongoDB, banco Redis e pasta temporária de cada worker dos testes e2e (#368).
 *
 * Os arquivos rodam em paralelo, e dois arquivos no mesmo banco ou na mesma fila geram
 * falhas falsas; com um conjunto por worker, cada arquivo continua sozinho na sua
 * infraestrutura, como na execução em série. Filas, agendamentos, cache e contadores do
 * throttler vivem no Redis, e por isso também ficam separados.
 *
 *  - MongoDB: `bios_test` vira `bios_w1_test`, `bios_w2_test`… O sufixo `_test` continua no
 *    fim; uma URL base sem ele gera nomes também sem ele, que o setup global recusa.
 *  - Redis: um índice por worker a partir do da URL base (1, 2, 3…), até o 15.
 *  - Pasta temporária: as suítes que conferem se um adapter apagou a pasta que criou leem o
 *    `tmpdir()`, e não podem ver as pastas de outro worker.
 */
export function e2eWorkersInfrastructure(options: {
  workers: string | undefined;
  databaseUrl: string;
  redisUrl: string;
}): E2eWorkersInfrastructure {
  const firstRedisDatabase = redisDatabaseOf(options.redisUrl);
  const workers = parseWorkers(
    options.workers,
    LAST_REDIS_DATABASE - firstRedisDatabase + 1,
  );
  const numbers = Array.from({ length: workers }, (_, index) => index + 1);

  return {
    workers,
    databaseUrls: numbers.map((worker) =>
      workerDatabaseUrl(options.databaseUrl, worker),
    ),
    redisUrls: numbers.map((worker) =>
      withRedisDatabase(options.redisUrl, firstRedisDatabase + worker - 1),
    ),
    temporaryDirectories: numbers.map((worker) =>
      join(tmpdir(), 'bios-e2e', `w${worker}`),
    ),
  };
}

function parseWorkers(value: string | undefined, maximum: number): number {
  if (value === undefined || value === '') {
    return Math.max(
      1,
      Math.min(DEFAULT_WORKERS, availableParallelism(), maximum),
    );
  }

  const workers = Number(value);

  if (!Number.isInteger(workers) || workers < 1 || workers > maximum) {
    throw new Error(
      `E2E_WORKERS="${value}" inválido: use um inteiro de 1 a ${maximum} ` +
        '(um banco do Redis por worker, do índice da URL de teste até o 15).',
    );
  }

  return workers;
}

function workerDatabaseUrl(baseUrl: string, worker: number): string {
  const name = databaseNameOf(baseUrl);
  const stem = name.endsWith(DISPOSABLE_DATABASE_SUFFIX)
    ? name.slice(0, -DISPOSABLE_DATABASE_SUFFIX.length)
    : name;
  const suffix = stem === name ? '' : DISPOSABLE_DATABASE_SUFFIX;
  const url = new URL(baseUrl);

  url.pathname = `/${encodeURIComponent(`${stem}_w${worker}${suffix}`)}`;

  return url.toString();
}

/** Índice do banco Redis na URL (`redis://host:porta/índice`); 0 quando omitido. */
export function redisDatabaseOf(url: string): number {
  return Number(new URL(url).pathname.replace('/', '') || 0);
}

function withRedisDatabase(baseUrl: string, database: number): string {
  const url = new URL(baseUrl);

  url.pathname = `/${database}`;

  return url.toString();
}
