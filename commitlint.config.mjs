// @ts-check

/**
 * Padrão de mensagens de commit: Conventional Commits.
 *
 *   <tipo>(<escopo opcional>): <descrição>
 *
 *   feat(accounts): adiciona confirmação de e-mail no cadastro
 *   fix(scoring): corrige sinal de evidências de conduta administrativa
 *   chore(ci): adiciona pipeline de lint e testes
 *
 * O escopo, quando usado, deve ser o módulo afetado (ou shared, ci, deps, docs).
 *
 * Corpo e rodapé sem limite de largura: commits do Dependabot trazem URLs longas.
 */

/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        // módulos de negócio
        'accounts',
        'authentication',
        'api-keys',
        'security',
        'mailing',
        'data-sources',
        'evidences',
        'companies',
        'scoring',
        // áreas transversais
        'app',
        'shared',
        'prisma',
        'ci',
        'deps',
        'deps-dev',
        'docs',
        'config',
        'release',
      ],
    ],
    'header-max-length': [2, 'always', 100],
    'subject-case': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
