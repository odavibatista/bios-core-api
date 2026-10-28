import {
  testDatabaseUrl,
  testRedisUrl,
  testTemporaryDirectory,
} from '../support/infrastructure.js';

/**
 * Aponta o processo do worker para a infraestrutura dele antes de cada arquivo e2e (#368).
 *
 * O `AppModule` lê `DATABASE_URL` e `REDIS_URL` do ambiente, e os adapters criam pastas em
 * `os.tmpdir()`, que lê `TMPDIR` (Linux e macOS) ou `TEMP`/`TMP` (Windows) a cada chamada.
 */
process.env.DATABASE_URL = testDatabaseUrl();
process.env.REDIS_URL = testRedisUrl();

const temporaryDirectory = testTemporaryDirectory();

process.env.TMPDIR = temporaryDirectory;
process.env.TEMP = temporaryDirectory;
process.env.TMP = temporaryDirectory;
