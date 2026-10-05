import { faker } from '../support/faker.js';

/**
 * Semente do Faker, aplicada antes de cada arquivo de teste.
 *
 * Sem `FAKER_SEED`, cada execução sorteia uma semente nova e os testes rodam
 * com dados diferentes a cada vez. Quando um teste falha, a semente usada é
 * exibida; informá-la em `FAKER_SEED` repete exatamente os mesmos dados:
 *
 *   FAKER_SEED=<semente> npx vitest run <arquivo>
 */
const seed = applySeed(process.env.FAKER_SEED);

beforeEach(({ onTestFailed }) => {
  onTestFailed(() => {
    console.error(
      `Dados do Faker gerados com a semente ${seed}. ` +
        `Para reproduzir: FAKER_SEED=${seed}`,
    );
  });
});

function applySeed(configured: string | undefined): number {
  if (configured === undefined || configured === '') return faker.seed();

  const seed = Number(configured);
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error(
      `FAKER_SEED deve ser um inteiro não negativo (recebido: "${configured}").`,
    );
  }

  return faker.seed(seed);
}
