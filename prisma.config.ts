import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Com um prisma.config.ts presente, a CLI do Prisma não carrega o .env por conta própria.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  // Raiz do schema multiarquivo. O Prisma lê recursivamente todos os arquivos .prisma de src/:
  //  - src/shared/infra/database/schema.prisma — generator e datasource;
  //  - src/modules/<módulo>/entity/*.prisma   — modelos, tipos compostos e enums de cada módulo.
  schema: 'src',
});
