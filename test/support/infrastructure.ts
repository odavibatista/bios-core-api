import { inject } from 'vitest';
import { databaseNameOf } from '@shared/infra/database/database-name.js';

/**
 * Endereços da infraestrutura de teste do worker em que o arquivo roda (#368).
 *
 * Cada worker dos testes e2e tem banco MongoDB, banco Redis e pasta temporária próprios
 * (ver `test/setup/e2e-workers.ts`). O `inject` entrega as listas de todos os workers;
 * as suítes pegam aqui o item do worker atual.
 */
function ofCurrentWorker(resources: string[]): string {
  // De 1 a `maxWorkers`, fixo durante a vida do worker.
  const worker = Number(process.env.VITEST_POOL_ID ?? 1);
  const resource = resources.at(worker - 1);

  if (resource === undefined) {
    throw new Error(
      `Worker ${worker} sem infraestrutura de teste: só ${resources.length} foram preparados.`,
    );
  }

  return resource;
}

/** Connection string do banco MongoDB descartável deste worker. */
export function testDatabaseUrl(): string {
  return ofCurrentWorker(inject('testDatabaseUrls'));
}

/** Nome do banco MongoDB descartável deste worker (ex.: `bios_w1_test`). */
export function testDatabaseName(): string {
  return databaseNameOf(testDatabaseUrl());
}

/** URL do banco Redis deste worker. */
export function testRedisUrl(): string {
  return ofCurrentWorker(inject('testRedisUrls'));
}

/** Pasta temporária deste worker, devolvida por `os.tmpdir()` durante as suítes. */
export function testTemporaryDirectory(): string {
  return ofCurrentWorker(inject('testTemporaryDirectories'));
}
