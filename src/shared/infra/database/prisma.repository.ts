import type { Prisma } from '@prisma/client';
import type { PaginationQuery } from '../../domain/dtos/requests/pagination.dto.js';
import type { PrismaService } from './prisma.service.js';

/**
 * Janela de paginação no formato aceito pelas consultas Prisma.
 */
export interface PrismaPagination {
  skip: number;
  take: number;
}

/**
 * Superclasse de todo repositório implementado sobre o Prisma.
 *
 * Cada repositório concreto estende esta classe e implementa o contrato
 * (classe abstrata) declarado em `domain/dtos/repositories` do seu módulo:
 *
 * @example
 * ```ts
 * @Injectable()
 * export class PrismaUserRepository extends PrismaRepository implements UserRepository {
 *   constructor(prisma: PrismaService) {
 *     super(prisma);
 *   }
 * }
 * ```
 */
export abstract class PrismaRepository {
  protected constructor(protected readonly prisma: PrismaService) {}

  /**
   * Converte a paginação recebida na query string para `skip`/`take`.
   */
  protected toPagination({
    page,
    page_size,
  }: PaginationQuery): PrismaPagination {
    return { skip: (page - 1) * page_size, take: page_size };
  }

  /**
   * Executa operações em uma transação (exige MongoDB em replica set).
   */
  protected transaction<TResult>(
    operation: (transaction: Prisma.TransactionClient) => Promise<TResult>,
  ): Promise<TResult> {
    return this.prisma.$transaction(operation);
  }
}
