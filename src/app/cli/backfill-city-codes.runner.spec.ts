import type { PrismaClient } from '@prisma/client';
import type {
  CityCodeBackfill,
  CityCodeGap,
} from '@modules/locations/infra/db/backfill/city-code-backfill.js';
import { CliExit } from './cli-support.js';
import {
  formatCityCodePlan,
  runCityCodeBackfill,
} from './backfill-city-codes.runner.js';

describe('comando locations:backfill', () => {
  const backfill = {
    plan: vi.fn<CityCodeBackfill['plan']>(),
    apply: vi.fn<CityCodeBackfill['apply']>(),
  };
  const lines: string[] = [];
  const run = (...argv: string[]) =>
    runCityCodeBackfill(argv, {
      client: {} as PrismaClient,
      databaseName: 'bios',
      backfill: backfill as unknown as CityCodeBackfill,
      write: (line) => lines.push(line),
    });
  const gaps: CityCodeGap[] = [
    { uf: 'RJ', city: 'PARATI', companies: 38, ibgeCode: '3303807' },
    { uf: 'SP', city: 'CAMPINAS', companies: 2, ibgeCode: '3509502' },
    { uf: 'EX', city: 'EXTERIOR', companies: 11, ibgeCode: null },
  ];

  beforeEach(() => {
    lines.length = 0;
    backfill.plan.mockResolvedValue(gaps);
    backfill.apply.mockResolvedValue(40);
  });

  it('resume o plano e lista quem ficou de fora do catálogo', () => {
    expect(formatCityCodePlan(gaps)).toEqual([
      'A preencher: 40 cadastro(s) em 2 local(is).',
      'Sem correspondência no catálogo: 11 cadastro(s) em 1 local(is).',
      '  EXTERIOR/EX: 11',
    ]);
  });

  it('sem --apply, mostra o plano e não grava', async () => {
    await expect(run()).resolves.toBe(CliExit.OK);

    expect(backfill.apply).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('dry-run');
    expect(lines.at(-1)).toContain('Nada foi gravado');
  });

  it('com --apply, grava e informa quantos cadastros mudaram', async () => {
    await expect(run('--apply')).resolves.toBe(CliExit.OK);

    expect(backfill.apply).toHaveBeenCalledWith({}, gaps);
    expect(lines.at(-1)).toBe('Concluído: 40 cadastro(s).');
  });

  it('recusa opção desconhecida', async () => {
    await expect(run('--forcar')).resolves.toBe(CliExit.USAGE);

    expect(backfill.plan).not.toHaveBeenCalled();
    expect(lines[0]).toContain('--forcar');
  });

  it('falha sem revelar a conexão', async () => {
    backfill.plan.mockRejectedValue(
      new Error('sem acesso a mongodb://usuario:senha@host/bios'),
    );

    await expect(run()).resolves.toBe(CliExit.FAILURE);

    expect(lines.at(-1)).toBe('Falha: sem acesso a [conexão omitida]');
  });
});
