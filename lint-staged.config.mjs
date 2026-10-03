// @ts-check

/**
 * Barreira de qualidade do pre-commit (RNF NFSE09), aplicada apenas aos arquivos
 * em stage — o custo do hook cresce com o tamanho do commit, não do projeto.
 *
 * Arquivos corrigidos automaticamente (ESLint --fix, Prettier) voltam ao stage
 * sozinhos; qualquer problema restante bloqueia o commit.
 *
 * Os schemas Prisma não passam por aqui: são verificados uma única vez por
 * commit no próprio hook (.husky/pre-commit), pois o lint-staged divide listas
 * longas de arquivos em lotes e repetiria a verificação a cada lote.
 */

/** @type {import('lint-staged').Configuration} */
export default {
  // Código TypeScript: lint com regras type-aware, formatação e somente os
  // testes afetados pelos arquivos alterados (grafo de imports do Vitest).
  '*.ts': [
    'eslint --fix --max-warnings=0',
    'prettier --write',
    'vitest related --run --passWithNoTests',
  ],

  // Configurações e workflows. O lockfile fica de fora: é gerado pelo npm.
  '!(package-lock).json': 'prettier --write',
  '*.{yml,yaml}': 'prettier --write',
};
