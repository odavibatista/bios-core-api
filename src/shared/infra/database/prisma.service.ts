import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  type Environment,
  RuntimeEnvironment,
} from '../../config/environment.config.js';
import { UnsafeDatabaseOperationException } from '../../domain/errors/unsafe-database-operation.exception.js';
import type { DatabaseHealthProvider } from '../../domain/providers/database-health.provider.js';
import { databaseNameOf, isDisposableDatabase } from './database-name.js';
import type { DatabaseSeeder } from './database-seeder.js';

/** Tempo máximo de espera pela resposta do banco no health check. */
export const DATABASE_HEALTH_TIMEOUT_MS = 3_000;

/** Formato relevante da resposta do comando `listCollections`. */
const ListCollectionsResultSchema = z.object({
  cursor: z.object({
    firstBatch: z.array(z.object({ name: z.string() })),
  }),
});

/**
 * Cliente Prisma gerenciado pelo container de injeção do Nest.
 *
 * Única forma de acesso ao banco: repositórios recebem esta classe por injeção,
 * nunca uma instância global de `PrismaClient`, o que mantém o acesso a dados
 * substituível em teste via `overrideProvider`.
 *
 * A conexão com o MongoDB é estabelecida sob demanda na primeira consulta; assim
 * a aplicação sobe mesmo com o banco fora do ar e o health check reporta a falha.
 *
 * As operações de preparação de banco (`seed`, `reset`) existem para os testes
 * e2e e só executam em banco descartável: `NODE_ENV=test` e nome de banco com
 * sufixo `_test`. A dupla verificação impede que uma configuração errada de
 * ambiente apague dados reais.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleDestroy, DatabaseHealthProvider
{
  private readonly environment: string;
  private readonly databaseName: string;

  constructor(configService: ConfigService<Environment, true>) {
    const datasourceUrl = configService.get('DATABASE_URL', { infer: true });

    super({ datasourceUrl });

    this.environment = configService.get('NODE_ENV', { infer: true });
    this.databaseName = databaseNameOf(datasourceUrl);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Verifica se o banco responde a um `ping` dentro do tempo limite.
   */
  async isAvailable(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), DATABASE_HEALTH_TIMEOUT_MS);
    });

    const ping = this.$runCommandRaw({ ping: 1 }).then(
      () => true,
      () => false,
    );

    try {
      return await Promise.race([ping, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Executa os seeders na ordem informada (seeders dependentes por último).
   *
   * @throws {UnsafeDatabaseOperationException} fora de um banco descartável.
   */
  async seed(seeders: readonly DatabaseSeeder[]): Promise<void> {
    this.assertDisposableDatabase('seed');

    for (const seeder of seeders) {
      await seeder.run(this);
    }
  }

  /**
   * Remove todos os documentos das coleções informadas, preservando coleções e
   * índices (mais rápido que recriá-los a cada suíte).
   *
   * @param collections nomes físicos das coleções, ou `'all'` para todas.
   * @throws {UnsafeDatabaseOperationException} fora de um banco descartável.
   */
  async reset(collections: readonly string[] | 'all' = 'all'): Promise<void> {
    this.assertDisposableDatabase('reset');

    const names =
      collections === 'all' ? await this.listCollectionNames() : collections;

    await Promise.all(
      names.map((name) =>
        this.$runCommandRaw({ delete: name, deletes: [{ q: {}, limit: 0 }] }),
      ),
    );
  }

  private async listCollectionNames(): Promise<string[]> {
    const result = await this.$runCommandRaw({
      listCollections: 1,
      nameOnly: true,
      filter: { type: 'collection' },
    });

    return ListCollectionsResultSchema.parse(result)
      .cursor.firstBatch.map(({ name }) => name)
      .filter((name) => !name.startsWith('system.'));
  }

  private assertDisposableDatabase(operation: string): void {
    if (
      this.environment !== RuntimeEnvironment.TEST ||
      !isDisposableDatabase(this.databaseName)
    ) {
      throw new UnsafeDatabaseOperationException(
        operation,
        this.environment,
        this.databaseName,
      );
    }
  }
}
