import type { PrismaClient } from '@prisma/client';
import type {
  CityCodeBackfill,
  CityCodeGap,
} from '@modules/locations/infra/db/backfill/city-code-backfill.js';
import { CliExit, safeMessage } from './cli-support.js';

export interface CityCodeBackfillCliDeps {
  client: PrismaClient;
  /** Só o nome do banco: a connection string (com credenciais) nunca chega aqui. */
  databaseName: string;
  backfill: CityCodeBackfill;
  write: (line: string) => void;
}

const USAGE = [
  'Uso: npm run locations:backfill [-- --apply]',
  '',
  '  (sem opção)  mostra quantos cadastros receberiam o código IBGE (dry-run); não grava nada',
  '  --apply      grava o código nos cadastros cujo local está no catálogo',
  '',
  'Idempotente. Cadastro que já tem código nunca é alterado. Rode depois de catalog:bootstrap.',
];

const companiesIn = (gaps: readonly CityCodeGap[]) =>
  gaps.reduce((total, { companies }) => total + companies, 0);

/** O plano em linhas legíveis, com cada local sem correspondência no catálogo. */
export function formatCityCodePlan(gaps: readonly CityCodeGap[]): string[] {
  const known = gaps.filter(({ ibgeCode }) => ibgeCode !== null);
  const unknown = gaps.filter(({ ibgeCode }) => ibgeCode === null);

  return [
    `A preencher: ${companiesIn(known)} cadastro(s) em ${known.length} local(is).`,
    `Sem correspondência no catálogo: ${companiesIn(unknown)} cadastro(s) em ${unknown.length} local(is).`,
    ...unknown.map(
      ({ city, uf, companies }) => `  ${city}/${uf}: ${companies}`,
    ),
  ];
}

/**
 * Comando que preenche o código IBGE dos cadastros já gravados (RF38). Dry-run por padrão;
 * `--apply` grava. Devolve o código de saída do processo (0 ok, 1 falha, 2 uso incorreto).
 */
export async function runCityCodeBackfill(
  argv: readonly string[],
  { client, databaseName, backfill, write }: CityCodeBackfillCliDeps,
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

    const gaps = await backfill.plan(client);

    formatCityCodePlan(gaps).forEach(write);

    if (!apply) {
      write('Nada foi gravado. Rode com --apply para preencher os códigos.');

      return CliExit.OK;
    }

    write(`Concluído: ${await backfill.apply(client, gaps)} cadastro(s).`);

    return CliExit.OK;
  } catch (error) {
    write(`Falha: ${safeMessage(error)}`);

    return CliExit.FAILURE;
  }
}
