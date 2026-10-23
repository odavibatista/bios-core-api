import type { PrismaClient } from '@prisma/client';
import {
  summarizeCatalogPlan,
  type CatalogSyncPlan,
  type CatalogValue,
} from '@modules/data-sources/domain/catalog-sync.js';
import type { DataSourceCatalogSync } from '@modules/data-sources/infra/db/catalog-sync/data-source-catalog-sync.js';

export interface CatalogSyncCliDeps {
  client: PrismaClient;
  /** Só o nome do banco: a connection string (com credenciais) nunca chega aqui. */
  databaseName: string;
  catalog: DataSourceCatalogSync;
  write: (line: string) => void;
}

const USAGE = [
  'Uso: npm run catalog:sync [-- --apply]',
  '',
  '  (sem opção)  mostra o que mudaria no catálogo de fontes (dry-run); não grava nada',
  '  --apply      grava: cria as fontes ausentes e atualiza os campos do contrato que divergem',
  '',
  'Campos operacionais (is_enabled, rate_limit_per_minute, fallback_priority) nunca são alterados.',
];

const show = (value: CatalogValue) => JSON.stringify(value);

/** O plano em linhas legíveis: uma fonte por bloco, com cada campo de `de -> para`. */
export function formatCatalogPlan(plan: CatalogSyncPlan): string[] {
  const lines: string[] = [];

  for (const entry of plan.entries) {
    const label =
      entry.action === 'CREATE'
        ? 'CRIAR (ausente no banco)'
        : entry.action === 'UPDATE'
          ? 'ATUALIZAR'
          : 'igual';

    lines.push(`${entry.slug}: ${label}`);

    for (const { field, from, to } of entry.changes) {
      lines.push(`  ${field}: ${show(from)} -> ${show(to)}`);
    }

    for (const { field, current, seed } of entry.preserved) {
      lines.push(
        `  (mantido) ${field}: ${show(current)} no banco, ${show(seed)} no seed`,
      );
    }
  }

  for (const slug of plan.unknownSlugs) {
    lines.push(`${slug}: está no banco e não no código (não é alterada)`);
  }

  return lines;
}

/** Nunca devolve uma connection string, mesmo que o driver a inclua na mensagem. */
function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.replace(/mongodb(\+srv)?:\/\/\S+/gi, '[conexão omitida]');
}

/**
 * Comando de sincronização do catálogo de fontes (#256).
 *
 * Dry-run por padrão: sem `--apply` nada é gravado. Devolve o código de saída do
 * processo (0 ok, 1 falha, 2 uso incorreto).
 */
export async function runCatalogSync(
  argv: readonly string[],
  { client, databaseName, catalog, write }: CatalogSyncCliDeps,
): Promise<number> {
  const unknown = argv.filter((arg) => arg !== '--apply');

  if (unknown.length > 0) {
    write(`Opção desconhecida: ${unknown.join(' ')}`);
    USAGE.forEach(write);

    return 2;
  }

  const apply = argv.includes('--apply');

  try {
    write(
      `Banco: ${databaseName} (${apply ? 'gravação (--apply)' : 'dry-run, nada será gravado'})`,
    );

    const plan = await catalog.plan(client);

    formatCatalogPlan(plan).forEach(write);

    const { CREATE, UPDATE, UNCHANGED } = summarizeCatalogPlan(plan);

    write(
      `Resumo: ${CREATE} a criar, ${UPDATE} a atualizar, ${UNCHANGED} iguais.`,
    );

    if (CREATE + UPDATE === 0) {
      write('O catálogo já está em sincronia com o código.');

      return 0;
    }

    if (!apply) {
      write(
        'Nada foi gravado. Rode com --apply para aplicar o que está acima.',
      );

      return 0;
    }

    const result = await catalog.apply(client, plan);

    write(
      `Gravado: ${result.created} criada(s), ${result.updated} atualizada(s).`,
    );

    return 0;
  } catch (error) {
    write(`Falha: ${safeMessage(error)}`);

    return 1;
  }
}
