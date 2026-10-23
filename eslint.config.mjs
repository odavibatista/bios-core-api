// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      // `INestApplication.getHttpServer()` é tipado como `any` pelo próprio Nest.
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    // Nos testes, o Faker vem da instância com semente reproduzível. O código de
    // produção (ex.: honeypot) segue livre para importar o pacote.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
    ignores: ['test/support/faker.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@faker-js/faker', '@faker-js/faker/*'],
              message:
                'Nos testes, importe `faker` de test/support/faker.ts (instância com semente reproduzível).',
            },
          ],
        },
      ],
    },
  },
  {
    // O armazenamento de evidências não conhece as fontes que o alimentam nem o
    // orquestrador que as reúne (#254): a dependência vai só de fora para dentro.
    // Este bloco vem depois do anterior de propósito: `no-restricted-imports` não
    // se mescla entre blocos, então o aviso do Faker é repetido aqui.
    files: ['src/modules/evidences/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@faker-js/faker', '@faker-js/faker/*'],
              message:
                'Nos testes, importe `faker` de test/support/faker.ts (instância com semente reproduzível).',
            },
            {
              group: [
                '@modules/ibama',
                '@modules/ibama/*',
                '@modules/cgu',
                '@modules/cgu/*',
                '@modules/ghg',
                '@modules/ghg/*',
                '@modules/environmental-intelligence',
                '@modules/environmental-intelligence/*',
              ],
              message:
                'evidences não depende das fontes (ibama, cgu, ghg) nem do orquestrador: a orquestração fica em environmental-intelligence, que depende de evidences.',
            },
            {
              regex: '^(\.\./)+(ibama|cgu|ghg|environmental-intelligence)(/|$)',
              message:
                'evidences não depende das fontes (ibama, cgu, ghg) nem do orquestrador: a orquestração fica em environmental-intelligence, que depende de evidences.',
            },
          ],
        },
      ],
    },
  },
);
