import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  RetentionIndexOutcome,
  RetentionPolicy,
} from '../../domain/dtos/providers/retention-policy.dto.js';
import { RetentionIndexProvider } from '../../domain/providers/retention-index.provider.js';
import { PrismaService } from '../database/prisma.service.js';

/** Formato relevante da resposta do comando `listIndexes`. */
const ListIndexesResultSchema = z.object({
  cursor: z.object({
    firstBatch: z.array(
      z.object({
        name: z.string(),
        key: z.record(z.string(), z.unknown()),
        expireAfterSeconds: z.number().optional(),
      }),
    ),
  }),
});

type IndexDescription = z.infer<
  typeof ListIndexesResultSchema
>['cursor']['firstBatch'][number];

/** Erro do MongoDB para coleção ainda inexistente (código 26). */
const NAMESPACE_NOT_FOUND = /NamespaceNotFound|ns does not exist/i;

/**
 * Aplica políticas de retenção como índices TTL do MongoDB, via comandos crus
 * do Prisma (que não declara TTL no schema).
 *
 * Para cada política:
 *  - índice ausente (ex.: `db push` ainda não executado) → criado já com TTL;
 *  - índice simples, criado pelo Prisma → convertido em TTL via `collMod`;
 *  - índice TTL com outro prazo → prazo atualizado via `collMod`, sem recriação;
 *  - índice TTL com o mesmo prazo → nenhuma operação.
 *
 * Exige MongoDB ≥ 5.1 (conversão de índice simples em TTL por `collMod`).
 */
@Injectable()
export class MongoRetentionIndexProvider extends RetentionIndexProvider {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  override async apply(
    policy: RetentionPolicy,
  ): Promise<RetentionIndexOutcome> {
    const { collection, field, indexName } = policy;
    const expireAfterSeconds = policy.retention.toSeconds();
    const existing = (await this.listIndexes(collection)).find(
      (index) => index.name === indexName,
    );

    if (!existing) {
      await this.prisma.$runCommandRaw({
        createIndexes: collection,
        indexes: [{ key: { [field]: 1 }, name: indexName, expireAfterSeconds }],
      });
      return 'created';
    }

    this.assertSingleFieldIndex(existing, policy);

    if (existing.expireAfterSeconds === expireAfterSeconds) return 'unchanged';

    await this.prisma.$runCommandRaw({
      collMod: collection,
      index: { name: indexName, expireAfterSeconds },
    });
    return 'updated';
  }

  private async listIndexes(collection: string): Promise<IndexDescription[]> {
    try {
      const result = await this.prisma.$runCommandRaw({
        listIndexes: collection,
      });
      return ListIndexesResultSchema.parse(result).cursor.firstBatch;
    } catch (error) {
      if (error instanceof Error && NAMESPACE_NOT_FOUND.test(error.message)) {
        return [];
      }
      throw error;
    }
  }

  /**
   * TTL só funciona em índice de campo único; um índice homônimo sobre outra
   * chave indica divergência entre o schema Prisma e a política configurada.
   */
  private assertSingleFieldIndex(
    index: IndexDescription,
    { collection, field, indexName }: RetentionPolicy,
  ): void {
    const keys = Object.keys(index.key);

    if (keys.length !== 1 || keys[0] !== field) {
      throw new Error(
        `Índice ${collection}.${indexName} cobre [${keys.join(', ')}], ` +
          `mas a política de retenção exige índice simples sobre "${field}".`,
      );
    }
  }
}
