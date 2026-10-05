import type { Faker } from '@faker-js/faker';
// Importa só o locale pt-BR: a raiz do pacote carrega todos os locales.
import { faker as fakerPtBr } from '@faker-js/faker/locale/pt_BR';

/**
 * Instância do Faker usada por todas as suítes de teste, com locale pt-BR.
 *
 * Os testes importam o Faker sempre daqui, nunca de `@faker-js/faker`: a
 * semente aplicada em `test/setup/faker.setup.ts` vale apenas para esta
 * instância, e é ela que permite reproduzir os dados de uma execução.
 */
export const faker: Faker = fakerPtBr;
