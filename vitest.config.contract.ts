import { defineConfig } from 'vitest/config';

/**
 * Testes de contrato contra as fontes externas reais (IBAMA, CGU e GHG).
 *
 * Ficam fora do `verify`, do pre-push e do CI de pull request: dependem de rede,
 * de credencial e do humor de terceiros, e não podem bloquear uma entrega. Rodam
 * pelo workflow `contract.yml` (agendado e manual) ou, localmente, por
 * `npm run test:contract`. Sem banco, sem Redis e sem AppModule: usam os mesmos
 * leitores e contratos do código de produção, só que apontados para a fonte real.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    root: './',
    include: ['test/contract/**/*.contract-spec.ts'],
    // Uma fonte por vez: o limite por minuto da CGU e a gentileza com terceiros.
    fileParallelism: false,
    // O download dos dumps do IBAMA leva minutos.
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
