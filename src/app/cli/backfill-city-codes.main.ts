import { PrismaClient } from '@prisma/client';
import { CityCodeBackfill } from '@modules/locations/infra/db/backfill/city-code-backfill.js';
import { databaseNameOf } from '@shared/infra/database/database-name.js';
import { runCityCodeBackfill } from './backfill-city-codes.runner.js';
import { loadDotEnv } from './cli-support.js';

/**
 * Entrada do comando `npm run locations:backfill`: lê o `.env`, conecta ao banco apontado por
 * `DATABASE_URL` e delega ao runner. Fica fora da API, e nada é gravado sem `--apply`.
 */
async function main(): Promise<void> {
  loadDotEnv();

  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('DATABASE_URL ausente: não há banco para preencher.');
    process.exit(1);
  }

  const client = new PrismaClient();
  const code = await runCityCodeBackfill(process.argv.slice(2), {
    client,
    databaseName: databaseNameOf(url),
    backfill: new CityCodeBackfill(),
    write: (line) => console.log(line),
  }).finally(() => client.$disconnect());

  process.exit(code);
}

void main();
