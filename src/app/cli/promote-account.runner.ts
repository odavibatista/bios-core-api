import {
  type PrismaClient,
  SessionRevocationReason,
  UserRole,
} from '@prisma/client';
import { normalizeEmail } from '@shared/domain/value-objects/email-address.js';
import { CliExit, safeMessage } from './cli-support.js';

export interface PromoteAccountCliDeps {
  client: PrismaClient;
  /** Só o nome do banco: a connection string (com credenciais) nunca chega aqui. */
  databaseName: string;
  /** Índice cego do e-mail, o mesmo do login (a chave não sai do ambiente). */
  blindIndex: (value: string) => string;
  write: (line: string) => void;
}

const USAGE = [
  'Uso: npm run account:promote -- --email <e-mail> [--demote] [--apply]',
  '',
  '  --email <e-mail>  conta a alterar (obrigatório)',
  '  --demote          rebaixa um ADMIN a USER (sem a opção, promove um USER a ADMIN)',
  '  --apply           grava; sem ela é só dry-run e nada é alterado',
  '',
  'A troca encerra as sessões abertas da conta: o papel viaja no access token, então o',
  'titular entra de novo e já recebe o papel novo. Só promove conta com o e-mail confirmado,',
  'e não rebaixa o último administrador ativo.',
];

interface ParsedArgs {
  email: string;
  demote: boolean;
  apply: boolean;
}

/** Interpreta os argumentos; devolve o motivo quando o uso está incorreto. */
function parseArgs(argv: readonly string[]): ParsedArgs | string {
  let email: string | undefined;
  let demote = false;
  let apply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--demote') demote = true;
    else if (arg === '--apply') apply = true;
    else if (arg === '--email') {
      email = argv[index + 1];
      index += 1;
    } else return `Opção desconhecida: ${arg}`;
  }

  if (!email || email.startsWith('--')) return 'Informe o e-mail com --email.';

  return { email, demote, apply };
}

/**
 * Comando de troca de papel de uma conta (#329): promove a `ADMIN` ou rebaixa a `USER`.
 *
 * O administrador é a mesma entidade da conta comum, diferenciada só pelo papel
 * (`11-Permissões`, §11.3), e a promoção não tem interface no MVP: é este comando. Dry-run
 * por padrão; `--apply` grava o papel **e** encerra as sessões abertas da conta, porque o
 * papel viaja no access token e uma sessão antiga continuaria valendo com o papel velho
 * (um administrador rebaixado seguiria administrador até o token vencer).
 *
 * Devolve o código de saída do processo (0 ok, 1 falha, 2 uso incorreto).
 */
export async function runPromoteAccount(
  argv: readonly string[],
  { client, databaseName, blindIndex, write }: PromoteAccountCliDeps,
): Promise<number> {
  const parsed = parseArgs(argv);

  if (typeof parsed === 'string') {
    write(parsed);
    USAGE.forEach(write);

    return CliExit.USAGE;
  }

  const { email, demote, apply } = parsed;
  const target = demote ? UserRole.USER : UserRole.ADMIN;

  try {
    write(
      `Banco: ${databaseName} (${apply ? 'gravação (--apply)' : 'dry-run, nada será gravado'})`,
    );

    const account = await client.user.findUnique({
      where: { email_hash: blindIndex(normalizeEmail(email)) },
      select: { id_user: true, role: true, is_active: true },
    });

    if (!account) {
      write('Nenhuma conta com esse e-mail.');

      return CliExit.FAILURE;
    }

    write(
      `Conta ${account.id_user}: papel ${account.role}, e-mail ${account.is_active ? 'confirmado' : 'não confirmado'}.`,
    );

    if (account.role === target) {
      write(`A conta já é ${target}: nada a alterar.`);

      return CliExit.OK;
    }

    if (target === UserRole.ADMIN && !account.is_active) {
      write(
        'A conta não confirmou o e-mail: confirme-o antes de promovê-la a ADMIN.',
      );

      return CliExit.FAILURE;
    }

    if (target === UserRole.USER) {
      const otherAdmins = await client.user.count({
        where: {
          role: UserRole.ADMIN,
          is_active: true,
          id_user: { not: account.id_user },
        },
      });

      if (otherAdmins === 0) {
        write(
          'Esta é a única conta ADMIN ativa: promova outra antes de rebaixá-la.',
        );

        return CliExit.FAILURE;
      }
    }

    const activeSessions = await client.userSession.count({
      where: {
        user_id: account.id_user,
        OR: [{ revoked_at: null }, { revoked_at: { isSet: false } }],
      },
    });

    write(
      `Papel: ${account.role} -> ${target}; ${activeSessions} sessão(ões) aberta(s) serão encerradas.`,
    );

    if (!apply) {
      write('Nada foi gravado. Rode com --apply para aplicar.');

      return CliExit.OK;
    }

    await client.$transaction([
      client.user.update({
        where: { id_user: account.id_user },
        data: { role: target },
      }),
      client.userSession.updateMany({
        where: {
          user_id: account.id_user,
          OR: [{ revoked_at: null }, { revoked_at: { isSet: false } }],
        },
        data: {
          revoked_at: new Date(),
          revocation_reason: SessionRevocationReason.ROLE_CHANGE,
        },
      }),
    ]);

    write(
      `Gravado: papel ${target}; ${activeSessions} sessão(ões) encerrada(s). O titular precisa entrar de novo.`,
    );

    return CliExit.OK;
  } catch (error) {
    write(`Falha: ${safeMessage(error)}`);

    return CliExit.FAILURE;
  }
}
