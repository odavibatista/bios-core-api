import type { PrismaClient } from '@prisma/client';
import { DATA_SOURCES } from '@modules/data-sources/infra/db/seeders/data-sources.seeder.js';
import { REFERENCE_ODS } from '@modules/scoring/infra/db/seeders/ods.seeder.js';
import { SEED_BLOCKED_EMAIL_DOMAINS } from '@modules/security/infra/db/seeders/blocked-email-domains.seeder.js';
import type { DatabaseSeeder } from '@shared/infra/database/database-seeder.js';
import { CliExit, safeMessage } from './cli-support.js';

export interface CatalogBootstrapCliDeps {
  client: PrismaClient;
  /** Só o nome do banco: a connection string (com credenciais) nunca chega aqui. */
  databaseName: string;
  /** Seeders de catálogo, na ordem de dependência (ODS, fontes, blacklist). */
  seeders: readonly DatabaseSeeder[];
  write: (line: string) => void;
}

/** O que a carga faria em cada catálogo. */
export interface CatalogBootstrapPlan {
  ods: { create: number; update: number; unchanged: number };
  dataSources: { create: number; existing: number };
  blockedDomains: { create: number; existing: number };
}

const USAGE = [
  'Uso: npm run catalog:bootstrap [-- --apply]',
  '',
  '  (sem opção)  mostra o que seria carregado (dry-run); não grava nada',
  '  --apply      grava o que falta: ODS, fontes de dados e blacklist de domínios',
  '',
  'Idempotente. Só cria o que falta: fontes e domínios que já existem nunca são alterados',
  '(ajustes de operação e remoções do administrador prevalecem). Os ODS, de texto oficial,',
  'são reaplicados. Para alinhar uma fonte existente ao contrato do código, use catalog:sync.',
];

/** Compara o código com o banco, sem gravar nada. */
export async function planCatalogBootstrap(
  client: PrismaClient,
): Promise<CatalogBootstrapPlan> {
  const [ods, sources, blocked] = await Promise.all([
    client.ods.findMany({
      select: { ods_number: true, title: true, description: true },
    }),
    client.dataSource.findMany({ select: { slug: true } }),
    client.blockedEmailDomain.findMany({
      where: { domain: { in: [...SEED_BLOCKED_EMAIL_DOMAINS] } },
      select: { domain: true },
    }),
  ]);
  const odsByNumber = new Map(ods.map((item) => [item.ods_number, item]));
  const knownSlugs = new Set(sources.map(({ slug }) => slug));
  const plan: CatalogBootstrapPlan = {
    ods: { create: 0, update: 0, unchanged: 0 },
    dataSources: { create: 0, existing: 0 },
    blockedDomains: {
      create: SEED_BLOCKED_EMAIL_DOMAINS.length - blocked.length,
      existing: blocked.length,
    },
  };

  for (const reference of REFERENCE_ODS) {
    const current = odsByNumber.get(reference.ods_number);

    if (!current) plan.ods.create += 1;
    else if (
      current.title !== reference.title ||
      current.description !== reference.description
    ) {
      plan.ods.update += 1;
    } else plan.ods.unchanged += 1;
  }

  for (const { slug } of DATA_SOURCES) {
    if (knownSlugs.has(slug)) plan.dataSources.existing += 1;
    else plan.dataSources.create += 1;
  }

  return plan;
}

/** O plano em linhas legíveis. */
export function formatBootstrapPlan(plan: CatalogBootstrapPlan): string[] {
  return [
    `ODS: ${plan.ods.create} a criar, ${plan.ods.update} a atualizar (texto oficial), ${plan.ods.unchanged} iguais.`,
    `Fontes de dados: ${plan.dataSources.create} a criar, ${plan.dataSources.existing} já existem (não são alteradas; veja catalog:sync).`,
    `Blacklist de domínios: ${plan.blockedDomains.create} a criar, ${plan.blockedDomains.existing} já existem.`,
  ];
}

function pendingChanges(plan: CatalogBootstrapPlan): number {
  return (
    plan.ods.create +
    plan.ods.update +
    plan.dataSources.create +
    plan.blockedDomains.create
  );
}

/**
 * Comando de carga inicial dos catálogos de referência (#329).
 *
 * Prepara um banco novo: ODS, fontes de dados e blacklist de domínios, que antes só os
 * testes carregavam. Dry-run por padrão; `--apply` grava. Devolve o código de saída do
 * processo (0 ok, 1 falha, 2 uso incorreto).
 */
export async function runCatalogBootstrap(
  argv: readonly string[],
  { client, databaseName, seeders, write }: CatalogBootstrapCliDeps,
): Promise<number> {
  const unknown = argv.filter((arg) => arg !== '--apply');

  if (unknown.length > 0) {
    write(`Opção desconhecida: ${unknown.join(' ')}`);
    USAGE.forEach(write);

    return CliExit.USAGE;
  }

  const apply = argv.includes('--apply');

  try {
    write(
      `Banco: ${databaseName} (${apply ? 'gravação (--apply)' : 'dry-run, nada será gravado'})`,
    );

    const plan = await planCatalogBootstrap(client);

    formatBootstrapPlan(plan).forEach(write);

    if (pendingChanges(plan) === 0) {
      write('Os catálogos já estão carregados.');

      return CliExit.OK;
    }

    if (!apply) {
      write(
        'Nada foi gravado. Rode com --apply para carregar o que está acima.',
      );

      return CliExit.OK;
    }

    for (const seeder of seeders) {
      await seeder.run(client);
      write(`Carregado: ${seeder.name}.`);
    }

    const after = pendingChanges(await planCatalogBootstrap(client));

    write(
      after === 0
        ? 'Concluído: os catálogos estão carregados.'
        : `Atenção: ainda restam ${after} item(ns) por carregar.`,
    );

    return after === 0 ? CliExit.OK : CliExit.FAILURE;
  } catch (error) {
    write(`Falha: ${safeMessage(error)}`);

    return CliExit.FAILURE;
  }
}
