import { PrismaClient } from '@prisma/client';
import { databaseNameOf } from '@shared/infra/database/database-name.js';
import { CATALOG_SEEDERS } from '../database/catalog.seeders.js';
import { runCatalogBootstrap } from './bootstrap-catalog.runner.js';
import { loadDotEnv } from './cli-support.js';

/**
 * Entrada do comando `npm run catalog:bootstrap` (#329): lê o `.env`, conecta ao banco
 * apontado por `DATABASE_URL` e delega ao runner. Fica fora da API: nada aqui roda no
 * boot, e nada é gravado sem `--apply`.
 */
async function main(): Promise<void> {
  loadDotEnv();

  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('DATABASE_URL ausente: não há banco para preparar.');
    process.exit(1);
  }

  const client = new PrismaClient();
  const code = await runCatalogBootstrap(process.argv.slice(2), {
    client,
    databaseName: databaseNameOf(url),
    seeders: CATALOG_SEEDERS,
    write: (line) => console.log(line),
  }).finally(() => client.$disconnect());

  process.exit(code);
}

void main();
