import type { PrismaClient } from '@prisma/client';

/**
 * Superclasse dos seeders: populam o banco com dados de referência de um módulo.
 *
 * Implementações devem ser idempotentes (upsert pela chave natural), para que
 * possam ser executadas repetidas vezes. Dados ajustáveis em produção (ex.:
 * configuração de fontes, blacklist) são apenas criados quando ausentes — um
 * novo seed nunca sobrescreve ajustes feitos depois da carga inicial.
 */
export abstract class DatabaseSeeder {
  /** Identificador do seeder, usado em logs e mensagens de erro. */
  abstract readonly name: string;

  abstract run(client: PrismaClient): Promise<void>;
}
