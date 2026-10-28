import { tmpdir } from 'node:os';
import {
  databaseNameOf,
  isDisposableDatabase,
} from '@shared/infra/database/database-name.js';
import { inject } from 'vitest';
import { e2eWorkersInfrastructure } from '../setup/e2e-workers.js';
import { buildTestEnvironment } from '../support/environment.js';
import {
  testDatabaseName,
  testDatabaseUrl,
  testRedisUrl,
  testTemporaryDirectory,
} from '../support/infrastructure.js';

/**
 * Isolamento dos arquivos e2e que rodam em paralelo (#368): cada worker tem banco
 * MongoDB, banco Redis e pasta temporária próprios, e tudo o que as suítes usam aponta
 * para eles.
 */
describe('Infraestrutura e2e por worker', () => {
  describe('no worker em execução', () => {
    it('cada worker recebe banco, Redis e pasta temporária distintos', () => {
      const resources = [
        inject('testDatabaseUrls'),
        inject('testRedisUrls'),
        inject('testTemporaryDirectories'),
      ];

      for (const list of resources) {
        expect(new Set(list).size).toBe(list.length);
      }
    });

    it('o processo aponta para o banco, o Redis e a pasta do próprio worker', () => {
      expect(process.env.DATABASE_URL).toBe(testDatabaseUrl());
      expect(process.env.REDIS_URL).toBe(testRedisUrl());
      expect(tmpdir()).toBe(testTemporaryDirectory());
    });

    it('buildTestEnvironment() entrega o banco e o Redis do worker', () => {
      expect(buildTestEnvironment()).toMatchObject({
        DATABASE_URL: testDatabaseUrl(),
        REDIS_URL: testRedisUrl(),
      });
    });

    it('o banco do worker continua descartável e leva o número do worker', () => {
      expect(isDisposableDatabase(testDatabaseName())).toBe(true);
      expect(testDatabaseName()).toContain(
        `_w${process.env.VITEST_POOL_ID ?? 1}_`,
      );
    });
  });

  describe('e2eWorkersInfrastructure', () => {
    const base = {
      databaseUrl: 'mongodb://localhost:27017/bios_test?directConnection=true',
      redisUrl: 'redis://localhost:6379/3',
    };

    it('um banco por worker, com o sufixo _test no fim, e um índice do Redis a partir do da URL', () => {
      const infrastructure = e2eWorkersInfrastructure({
        ...base,
        workers: '3',
      });

      expect(infrastructure.workers).toBe(3);
      expect(infrastructure.databaseUrls.map(databaseNameOf)).toEqual([
        'bios_w1_test',
        'bios_w2_test',
        'bios_w3_test',
      ]);
      expect(infrastructure.databaseUrls[0]).toContain('directConnection=true');
      expect(infrastructure.redisUrls).toEqual([
        'redis://localhost:6379/3',
        'redis://localhost:6379/4',
        'redis://localhost:6379/5',
      ]);
      expect(new Set(infrastructure.temporaryDirectories).size).toBe(3);
    });

    it('uma URL base sem _test gera bancos sem _test, que o setup global recusa', () => {
      const { databaseUrls } = e2eWorkersInfrastructure({
        ...base,
        databaseUrl: 'mongodb://localhost:27017/bios',
        workers: '1',
      });

      expect(isDisposableDatabase(databaseNameOf(databaseUrls[0]))).toBe(false);
    });

    it('aceita workers até o banco 15 do Redis', () => {
      const { redisUrls } = e2eWorkersInfrastructure({
        ...base,
        workers: '13',
      });

      expect(redisUrls.at(-1)).toBe('redis://localhost:6379/15');
    });

    it.each(['0', '-1', '1.5', 'quatro', '14'])(
      'recusa E2E_WORKERS=%s',
      (workers) => {
        expect(() => e2eWorkersInfrastructure({ ...base, workers })).toThrow(
          /E2E_WORKERS/,
        );
      },
    );

    it('sem E2E_WORKERS, usa de 1 a 4 workers', () => {
      const { workers } = e2eWorkersInfrastructure({
        ...base,
        workers: undefined,
      });

      expect(workers).toBeGreaterThanOrEqual(1);
      expect(workers).toBeLessThanOrEqual(4);
    });
  });
});
