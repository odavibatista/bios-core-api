import { type PrismaClient, SessionRevocationReason } from '@prisma/client';
import { runPromoteAccount } from './promote-account.runner.js';

describe('comando account:promote', () => {
  const ID = '6adcc00e2e8ffe22dc55ceee';
  const findUnique = vi.fn();
  const countUsers = vi.fn();
  const countSessions = vi.fn();
  const updateUser = vi.fn();
  const updateSessions = vi.fn();
  const transaction = vi.fn();
  const client = {
    user: { findUnique, count: countUsers, update: updateUser },
    userSession: { count: countSessions, updateMany: updateSessions },
    $transaction: transaction,
  } as unknown as PrismaClient;
  const lines: string[] = [];
  const blindIndex = vi.fn((value: string) => `idx(${value})`);

  const run = (...argv: string[]) =>
    runPromoteAccount(argv, {
      client,
      databaseName: 'bios',
      blindIndex,
      write: (line) => lines.push(line),
    });

  beforeEach(() => {
    lines.length = 0;
    findUnique.mockResolvedValue({
      id_user: ID,
      role: 'USER',
      is_active: true,
    });
    countUsers.mockResolvedValue(1);
    countSessions.mockResolvedValue(2);
    updateUser.mockReturnValue('update-user');
    updateSessions.mockReturnValue('update-sessions');
    transaction.mockResolvedValue([]);
  });

  describe('uso', () => {
    it.each([
      ['sem argumentos', [], 'Informe o e-mail com --email.'],
      ['--email sem valor', ['--email'], 'Informe o e-mail com --email.'],
      [
        '--email seguido de outra opção',
        ['--email', '--apply'],
        'Informe o e-mail com --email.',
      ],
      [
        'opção desconhecida',
        ['--email', 'a@b.co', '--force'],
        'Opção desconhecida: --force',
      ],
    ])(
      '%s: mostra o uso e sai com 2, sem tocar no banco',
      async (_c, argv, message) => {
        await expect(run(...argv)).resolves.toBe(2);

        expect(lines[0]).toBe(message);
        expect(lines.some((line) => line.startsWith('Uso: npm run'))).toBe(
          true,
        );
        expect(findUnique).not.toHaveBeenCalled();
      },
    );
  });

  describe('localização da conta', () => {
    it('procura pelo índice cego do e-mail normalizado (caixa e espaços)', async () => {
      await run('--email', '  Admin@Exemplo.COM ');

      expect(blindIndex).toHaveBeenCalledWith('admin@exemplo.com');
      expect(findUnique).toHaveBeenCalledWith({
        where: { email_hash: 'idx(admin@exemplo.com)' },
        select: { id_user: true, role: true, is_active: true },
      });
    });

    it('conta inexistente: sai com 1 e não grava', async () => {
      findUnique.mockResolvedValue(null);

      await expect(run('--email', 'x@y.co', '--apply')).resolves.toBe(1);

      expect(lines).toContain('Nenhuma conta com esse e-mail.');
      expect(transaction).not.toHaveBeenCalled();
    });

    it('não imprime o e-mail nem o nome da conta, só o identificador e o papel', async () => {
      await run('--email', 'segredo@exemplo.com');

      expect(lines.join('\n')).not.toContain('segredo@exemplo.com');
      expect(lines).toContain(`Conta ${ID}: papel USER, e-mail confirmado.`);
    });
  });

  describe('promoção', () => {
    it('dry-run (padrão): mostra a troca e as sessões afetadas, e não grava', async () => {
      await expect(run('--email', 'a@b.co')).resolves.toBe(0);

      expect(lines[0]).toBe('Banco: bios (dry-run, nada será gravado)');
      expect(lines).toContain(
        'Papel: USER -> ADMIN; 2 sessão(ões) aberta(s) serão encerradas.',
      );
      expect(lines).toContain(
        'Nada foi gravado. Rode com --apply para aplicar.',
      );
      expect(transaction).not.toHaveBeenCalled();
    });

    it('--apply: troca o papel e encerra as sessões abertas, numa transação só', async () => {
      await expect(run('--email', 'a@b.co', '--apply')).resolves.toBe(0);

      expect(updateUser).toHaveBeenCalledWith({
        where: { id_user: ID },
        data: { role: 'ADMIN' },
      });
      const { where, data } = updateSessions.mock.calls[0][0] as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      };

      expect(where).toEqual({
        user_id: ID,
        OR: [{ revoked_at: null }, { revoked_at: { isSet: false } }],
      });
      expect(data).toMatchObject({
        revocation_reason: SessionRevocationReason.ROLE_CHANGE,
      });
      expect(data.revoked_at).toBeInstanceOf(Date);
      expect(transaction).toHaveBeenCalledWith([
        'update-user',
        'update-sessions',
      ]);
      expect(lines.at(-1)).toBe(
        'Gravado: papel ADMIN; 2 sessão(ões) encerrada(s). O titular precisa entrar de novo.',
      );
    });

    it('conta que já é ADMIN: não faz nada, sem erro', async () => {
      findUnique.mockResolvedValue({
        id_user: ID,
        role: 'ADMIN',
        is_active: true,
      });

      await expect(run('--email', 'a@b.co', '--apply')).resolves.toBe(0);

      expect(lines).toContain('A conta já é ADMIN: nada a alterar.');
      expect(transaction).not.toHaveBeenCalled();
    });

    it('conta sem e-mail confirmado: recusa a promoção', async () => {
      findUnique.mockResolvedValue({
        id_user: ID,
        role: 'USER',
        is_active: false,
      });

      await expect(run('--email', 'a@b.co', '--apply')).resolves.toBe(1);

      expect(lines).toContain(
        'A conta não confirmou o e-mail: confirme-o antes de promovê-la a ADMIN.',
      );
      expect(transaction).not.toHaveBeenCalled();
    });
  });

  describe('rebaixamento (--demote)', () => {
    beforeEach(() => {
      findUnique.mockResolvedValue({
        id_user: ID,
        role: 'ADMIN',
        is_active: true,
      });
    });

    it('--apply: volta a USER e encerra as sessões, pelo mesmo motivo', async () => {
      await expect(
        run('--email', 'a@b.co', '--demote', '--apply'),
      ).resolves.toBe(0);

      expect(updateUser).toHaveBeenCalledWith({
        where: { id_user: ID },
        data: { role: 'USER' },
      });
      expect(updateSessions).toHaveBeenCalled();
      expect(lines).toContain(
        'Papel: ADMIN -> USER; 2 sessão(ões) aberta(s) serão encerradas.',
      );
    });

    it('confere se há outro ADMIN ativo (e não conta a própria conta)', async () => {
      await run('--email', 'a@b.co', '--demote', '--apply');

      expect(countUsers).toHaveBeenCalledWith({
        where: { role: 'ADMIN', is_active: true, id_user: { not: ID } },
      });
    });

    it('recusa rebaixar o último ADMIN ativo', async () => {
      countUsers.mockResolvedValue(0);

      await expect(
        run('--email', 'a@b.co', '--demote', '--apply'),
      ).resolves.toBe(1);

      expect(lines).toContain(
        'Esta é a única conta ADMIN ativa: promova outra antes de rebaixá-la.',
      );
      expect(transaction).not.toHaveBeenCalled();
    });

    it('rebaixar quem já é USER não faz nada', async () => {
      findUnique.mockResolvedValue({
        id_user: ID,
        role: 'USER',
        is_active: true,
      });

      await expect(
        run('--email', 'a@b.co', '--demote', '--apply'),
      ).resolves.toBe(0);

      expect(lines).toContain('A conta já é USER: nada a alterar.');
    });

    it('conta inativa pode ser rebaixada (a exigência de e-mail é só da promoção)', async () => {
      findUnique.mockResolvedValue({
        id_user: ID,
        role: 'ADMIN',
        is_active: false,
      });

      await expect(
        run('--email', 'a@b.co', '--demote', '--apply'),
      ).resolves.toBe(0);
    });
  });

  describe('falhas', () => {
    it('erro do banco: sai com 1 sem expor a connection string', async () => {
      findUnique.mockRejectedValue(
        new Error('falha em mongodb+srv://u:segredo@cluster/bios'),
      );

      await expect(run('--email', 'a@b.co')).resolves.toBe(1);

      expect(lines.at(-1)).toBe('Falha: falha em [conexão omitida]');
      expect(lines.join('\n')).not.toContain('segredo');
    });

    it('falha na transação: sai com 1 e não anuncia gravação', async () => {
      transaction.mockRejectedValue(new Error('transação abortada'));

      await expect(run('--email', 'a@b.co', '--apply')).resolves.toBe(1);

      expect(lines.some((line) => line.startsWith('Gravado'))).toBe(false);
      expect(lines.at(-1)).toBe('Falha: transação abortada');
    });
  });
});
