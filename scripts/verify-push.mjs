#!/usr/bin/env node
/**
 * Verificação rápida antes de publicar commits (#367).
 *
 * Roda o que é barato e decisivo: a verificação de tipos, o ESLint do projeto inteiro e
 * somente os testes unitários afetados pelos arquivos alterados (grafo de imports do Vitest,
 * `vitest related`). A suíte completa com cobertura (NFPD03) e os e2e ficam no CI, que os
 * executa em toda pull request e protege o merge (NFSE11); `npm run verify` continua
 * disponível para rodar tudo localmente.
 *
 * Arquivos alterados:
 *  - com `--stdin`, a lista chega pela entrada padrão, um por linha (é o que o hook
 *    `.husky/pre-push` envia: os arquivos de todos os commits ainda ausentes do remoto);
 *  - sem argumentos, é o diff da branch contra `origin/develop` (base comum), somado ao que
 *    ainda não foi commitado.
 *
 * Roda todos os unitários, em vez de nenhum, quando não é possível saber o que mudou (sem
 * base remota) ou quando a lista é grande demais para a linha de comando. Mudanças de
 * dependências, de configuração do TypeScript ou do Vitest e de schema Prisma também rodam
 * tudo: ver `forceRerunTriggers` em `vitest.config.ts`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Acima disto, a lista vai à suíte inteira (limite da linha de comando no Windows). */
const MAX_RELATED_FILES = 200;

const isWindows = process.platform === 'win32';

/** Executa um comando e encerra com o código dele se falhar. */
function step(label, command, args) {
  console.log(`\nverify:push — ${label}`);

  const { status } = spawnSync(command, args, {
    stdio: 'inherit',
    // `npm` e `npx` são scripts `.cmd` no Windows.
    shell: isWindows,
  });

  if (status !== 0) process.exit(status ?? 1);
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/** Arquivos alterados, ou `null` quando não há como saber. */
function changedFiles() {
  if (process.argv.includes('--stdin')) {
    return readFileSync(0, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  let base;

  try {
    base = git('merge-base', 'HEAD', 'origin/develop');
  } catch {
    return null;
  }

  const committed = git('diff', '--name-only', base, 'HEAD');
  const uncommitted = git('diff', '--name-only', 'HEAD');

  return [...new Set(`${committed}\n${uncommitted}`.split(/\r?\n/))].filter(
    Boolean,
  );
}

const started = Date.now();
const files = changedFiles();

step('verificação de tipos', 'npm', ['run', 'typecheck']);
step('ESLint do projeto inteiro', 'npm', [
  'run',
  'lint:check',
  '--',
  '--max-warnings=0',
]);

if (files === null || files.length > MAX_RELATED_FILES) {
  const reason =
    files === null
      ? 'sem base para comparar'
      : `${files.length} arquivos alterados`;

  step(`todos os testes unitários (${reason})`, 'npx', ['vitest', 'run']);
} else if (files.length === 0) {
  console.log('\nverify:push — nenhum arquivo alterado: testes dispensados.');
} else {
  step(
    `testes unitários afetados por ${files.length} arquivo(s) alterado(s)`,
    'npx',
    ['vitest', 'related', '--run', '--passWithNoTests', ...files],
  );
}

console.log(
  `\nverify:push — concluído em ${Math.round((Date.now() - started) / 1000)} s. ` +
    'A suíte completa com cobertura e os e2e rodam no CI.',
);
