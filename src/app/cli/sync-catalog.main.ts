import { PrismaClient } from '@prisma/client';
import { databaseNameOf } from '@shared/infra/database/database-name.js';
import { DataSourceCatalogSync } from '@modules/data-sources/infra/db/catalog-sync/data-source-catalog-sync.js';
import { loadDotEnv } from './cli-support.js';
import { runCatalogSync } from './sync-catalog.runner.js';

/**
 * Entrada do comando `npm run catalog:sync` (#256): lê o `.env`, conecta ao banco
 * apontado por `DATABASE_URL` e delega ao runner. Fica fora da API: nada aqui roda
 * no boot, e nada é gravado sem `--apply`.
 */
async function main(): Promise<void> {
  loadDotEnv();

  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('DATABASE_URL ausente: não há banco para sincronizar.');
    process.exit(1);
  }

  const client = new PrismaClient();
  const code = await runCatalogSync(process.argv.slice(2), {
    client,
    databaseName: databaseNameOf(url),
    catalog: new DataSourceCatalogSync(),
    write: (line) => console.log(line),
  }).finally(() => client.$disconnect());

  process.exit(code);
}

void main();
